/**
 * Authoritative host (GDD §21.4/§21.5/§21.7).
 * - 30 Hz simulation tick, at most 5 catch-up ticks per frame
 * - 15 Hz replica batches (every second tick)
 * - M2: ECDSA P-256 identity handshake (§22.4), M2 baseline with node /
 *   corpse / ground records, M2 intents through the tick loop, authoritative
 *   events forwarded with the following batch (§21.7: never dropped).
 */
import { randomBytes } from "node:crypto";
import { createWorld, runTick, placeWorldNodes, commitDeath, type World, type TickCommand, type TickEvents } from "@dustfall/sim";
import { EntityStore, newPlayer, type PlayerEntity, type WorldEntity, type CorpseEntity, type GroundItemEntity } from "@dustfall/sim";
import type { PlayerId, ItemId, EntityId } from "@dustfall/contracts";
import {
  ClientEnvelopeSchema,
  BaselineAckSchema,
  type SnapshotProto,
} from "@dustfall/protocol";
import { encode } from "@msgpack/msgpack";
import { BACKPRESSURE_QUEUE_BYTES, BACKPRESSURE_WINDOW_S } from "@dustfall/protocol";
import { REGIONS } from "@dustfall/content";
import { freshVitals } from "@dustfall/contracts";
import { SessionRegistry } from "./session.js";
import { derivePlayerId, freshNonce, verifyProof, issueSessionToken } from "./identity.js";

/** per-batch snapshot of node state, for delta computation */
interface NodeSnapshot {
  pool: number;
  accumulator: number;
  respawnAtTick: number;
}

export class Host {
  readonly world: World;
  readonly store: EntityStore;
  readonly sessions: SessionRegistry;
  private batchSequence = 0;
  private baselineId = 1;
  /** socket writers keyed by session id */
  private readonly writers = new Map<string, (data: Buffer, isBinary: boolean) => void>;
  /** HMAC secret for session tokens (per host boot, in memory only) */
  private readonly sessionSecret: Buffer = randomBytes(32);
  /** session id -> issued token (revocable, in memory) */
  private readonly issuedTokens = new Map<string, string>();
  /** entity id -> last-sent node payload */
  private readonly nodeSeen = new Map<string, NodeSnapshot>();
  /** entity id -> last-sent structure craft payload (null = idle) */
  private readonly structureSeen = new Map<string, { recipeId: string; completesAtTick: number; startedBy: string } | null>();
  /** entities sent to at least one ready session (new ones need a spawn record) */
  private readonly globalSent = new Set<string>();
  /** events awaiting forwarding (batches only fire on odd ticks; no tick's events may be dropped, §21.7) */
  private pendingEvents: TickEvents[] = [];
  /** hooks fired when a tick commits death transactions (GDD §21: high-impact save trigger) */
  private readonly deathHooks: Array<() => void> = [];
  /** sessions that have a live player entity */
  private readonly spawnedSessions = new Set<string>();

  constructor(private readonly serverId: string, worldId: string, seedA: number, seedB: number, maxPlayers: number) {
    this.world = createWorld(worldId, seedA, seedB);
    this.store = new EntityStore();
    this.sessions = new SessionRegistry();
    placeWorldNodes(this.world, this.store);
    void maxPlayers;
  }

  /** Register a session's binary writer. */
  attachWriter(sessionId: string, writer: (data: Buffer, isBinary: boolean) => void): void {
    this.writers.set(sessionId, writer);
  }

  detachWriter(sessionId: string): void {
    this.writers.delete(sessionId);
  }

  // ------------------------------------------------------------------
  // identity handshake (GDD §22.4)
  // ------------------------------------------------------------------

  /**
   * Open a session and issue the challenge. The session stays in
   * `awaiting_identity` until a valid proof arrives; gameplay input before
   * Ready is rejected.
   */
  beginHandshake(): { sessionId: string; nonce: string } {
    const sessionId = `s_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;
    const nonce = freshNonce();
    this.sessions.add({
      id: sessionId,
      playerId: "pending",
      state: "awaiting_identity",
      nonce,
      ackInputSequence: 0,
      pending: [],
      joinedAtTick: 0,
      queuedBytes: 0,
      backpressureSince: null,
      connectedAtMs: Date.now(),
      seen: new Set<string>(),
      baselineId: 0,
    });
    return { sessionId, nonce };
  }

  /**
   * Verify the identity proof and, on success, enter awaiting_baseline and
   * send the session grant + baseline. A reconnect within 5 minutes reuses
   * the player's previous session (same session id, sequence continues);
   * otherwise a fresh session is issued for the same PlayerId.
   */
  submitIdentity(sessionId: string, raw: unknown): { ok: true; grant: import("@dustfall/protocol").SessionGrantProto } | { ok: false; reason: string } {
    const session = this.sessions.get(sessionId);
    if (!session) return { ok: false, reason: "unknown_session" };
    if (session.state !== "awaiting_identity") return { ok: false, reason: "wrong_state" };
    const proof = typeof raw === "object" && raw !== null ? (raw as { publicKey?: unknown; signature?: unknown; nonce?: unknown; sessionId?: unknown }) : null;
    if (!proof || typeof proof.signature !== "string") return { ok: false, reason: "malformed_proof" };

    const JwkSchema = { parse: (v: unknown) => this.parseJwk(v) };
    const jwk = JwkSchema.parse((proof as { publicKey?: unknown }).publicKey);
    if (!jwk) return { ok: false, reason: "invalid_jwk" };
    const nonce = session.nonce;
    if (!nonce) return { ok: false, reason: "no_challenge" };
    if (!verifyProof(jwk, nonce, proof.signature)) return { ok: false, reason: "bad_signature" };

    const playerId = derivePlayerId(this.serverId, jwk);
    session.jwk = jwk;

    // duplicate identity: the newer session invalidates the older socket
    // (GDD 22.4). Stale records are dropped; a recently disconnected one
    // simply means the player entity is still alive in the world.
    const incumbent = this.sessions.sessionForPlayer(playerId);
    if (incumbent && incumbent.id !== sessionId) {
      this.invalidateSession(incumbent.id);
      this.removeSession(incumbent.id);
    }
    session.playerId = playerId;
    this.sessions.remove(sessionId); // drop the "pending" key
    this.sessions.add(session);

    // player entity: keep it (reconnect resumes the same body), spawn it if
    // it does not exist yet, respawn it if it died while away
    const existing = [...this.store.values()].find((e) => e.kind === "player" && e.playerId === playerId) as PlayerEntity | undefined;
    if (!existing) {
      this.spawnPlayerEntity(playerId);
    } else if (existing.dead) {
      // respawn after death while (re)connecting
      this.respawnEntity(existing);
    }

    const expiresAt = Date.now() + 24 * 60 * 60 * 1000;
    const token = issueSessionToken(this.serverId, playerId, sessionId, this.sessionSecret.toString("hex"));
    this.issuedTokens.set(sessionId, token);
    session.state = "awaiting_baseline";

    const grant: import("@dustfall/protocol").SessionGrantProto = {
      protocol: 1,
      sessionId,
      playerId,
      expiresAt,
      token,
      hasSavedPlayer: Boolean(existing),
    };
    this.sendJson(sessionId, { kind: "session_grant", ...grant });
    this.sendBaseline(sessionId);
    return { ok: true, grant };
  }

  /** Invalidate (kick) a session: stop its input, keep its world state. */
  invalidateSession(sessionId: string): void {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    s.lastDisconnectAtMs = Date.now();
    s.state = "connecting"; // no more input
    this.writers.get(sessionId)?.(Buffer.from(JSON.stringify({ protocol: 1, kind: "kicked", reason: "superseded" })), false);
  }

  /**
   * Dev-only: force-commit a death transaction for a player (M2 exit-gate
   * smoke: "die" without starvation). Returns the corpse entity id.
   */
  devKillPlayer(playerId: string): string | null {
    const p = [...this.store.values()].find((e) => e.kind === "player" && e.playerId === playerId) as PlayerEntity | undefined;
    if (!p || p.dead) return null;
    p.vitals.health = 0;
    p.dead = true;
    const tx = commitDeath(this.world, this.store, p);
    if (tx) {
      this.pendingEvents.push({ moved: [], died: [playerId], gathered: [], deaths: [tx], respawnedNodes: [], despawnedGround: [], inventory: [], crafted: [], researched: [], placed: [] });
      for (const h of this.deathHooks) h();
    }
    return tx?.corpseEntityId ?? null;
  }

  /** Acknowledge the baseline -> Ready. */
  ackBaseline(sessionId: string, raw: unknown): { ok: true } | { ok: false; reason: string } {
    const session = this.sessions.get(sessionId);
    if (!session) return { ok: false, reason: "unknown_session" };
    if (session.state !== "awaiting_baseline") return { ok: false, reason: "wrong_state" };
    const parsed = BaselineAckSchema.safeParse(raw);
    if (!parsed.success) return { ok: false, reason: "invalid_ack" };
    if (parsed.data.baselineId !== session.baselineId) return { ok: false, reason: "stale_baseline" };
    session.state = "ready";
    session.joinedAtTick = this.world.clock.tick;
    session.readyAtMs = Date.now();
    this.spawnedSessions.add(sessionId);
    return { ok: true };
  }

  // ------------------------------------------------------------------
  // gameplay
  // ------------------------------------------------------------------

  /**
   * Receive a gameplay envelope from a session. Validates and queues for
   * the next tick. Returns true if accepted.
   */
  receiveEnvelope(sessionId: string, raw: unknown): { ok: true } | { ok: false; reason: string } {
    const session = this.sessions.get(sessionId);
    if (!session) return { ok: false, reason: "unknown_session" };
    if (session.state !== "ready") return { ok: false, reason: "not_ready" };

    const parsed = ClientEnvelopeSchema.safeParse(raw);
    if (!parsed.success) return { ok: false, reason: "invalid_envelope" };
    if (parsed.data.sessionId !== sessionId) return { ok: false, reason: "session_mismatch" };
    if (parsed.data.sequence <= session.ackInputSequence) {
      return { ok: false, reason: "stale_sequence" };
    }
    session.ackInputSequence = parsed.data.sequence;
    session.pending.push(parsed.data);
    return { ok: true };
  }

  /** Run one simulation tick from queued envelopes; return true if a replica batch is due. */
  tick(): boolean {
    const commands: TickCommand[] = [];
    for (const session of this.sessions.all()) {
      if (session.state !== "ready") continue;
      const p = this.playerFor(session);
      for (const env of session.pending) {
        for (const cmd of env.commands) {
          if (cmd.kind !== "move") continue;
          const intent: TickCommand = {
            playerId: session.playerId,
            sequence: env.sequence,
            intent: {
              wishX: cmd.wishX,
              wishZ: cmd.wishZ,
              jump: cmd.jump,
              crouch: cmd.crouch,
              sprint: cmd.sprint,
              inWater: cmd.inWater,
            },
            yawHundredths: cmd.yawHundredths,
            pitchHundredths: cmd.pitchHundredths,
          };
          // M2 intents (server treats them as input only, §21.4)
          if (cmd.swing) intent.swing = cmd.swing;
          if (cmd.pickup) intent.pickup = cmd.pickup;
          if (cmd.drop) intent.drop = cmd.drop;
          if (cmd.moveItem) {
            const mi: TickCommand["moveItem"] = { from: cmd.moveItem.from, to: cmd.moveItem.to };
            if (cmd.moveItem.equip) mi.equip = cmd.moveItem.equip;
            intent.moveItem = mi;
          }
          // M3 intents
          if (cmd.craft) {
            const c: TickCommand["craft"] = { recipeId: cmd.craft.recipeId };
            if (cmd.craft.structureEntityId !== undefined) c.structureEntityId = cmd.craft.structureEntityId;
            intent.craft = c;
          }
          if (cmd.research) intent.research = cmd.research;
          if (cmd.place) intent.place = cmd.place;
          if (cmd.heldSlot !== undefined && p) {
            intent.heldItemId = p.inventory[cmd.heldSlot]?.itemId ?? null;
          }
          commands.push(intent);
        }
      }
      session.pending.length = 0;
    }

    const events = runTick(this.world, this.store, commands);
    this.pendingEvents.push(events);
    if (events.deaths.length > 0) {
      for (const h of this.deathHooks) h();
    }

    const batchDue = this.world.clock.tick % 2 === 1;
    if (batchDue) this.emitReplicaBatch();
    return batchDue;
  }

  /** Register a hook fired after a tick commits one or more death transactions. */
  onDeathCommitted(hook: () => void): void {
    this.deathHooks.push(hook);
  }

  private playerFor(session: import("./session.js").Session): PlayerEntity | undefined {
    for (const e of this.store.values()) {
      if (e.kind === "player" && e.playerId === session.playerId) return e as PlayerEntity;
    }
    return undefined;
  }

  private emitReplicaBatch(): void {
    const records: SnapshotProto["records"] = [];
    for (const e of this.store.values()) {
      if (e.kind === "player") {
        // player body deltas are emitted per-session below: every session
        // sees every LIVE player's body, but the inventory grid rides only
        // on the session's OWN record (a client never sees another
        // player's inventory, GDD §22)
      } else if (e.kind === "world") {
        const w = e as WorldEntity;
        const seen = this.nodeSeen.get(e.id);
        if (!seen || seen.pool !== w.pool || seen.accumulator !== w.accumulator || seen.respawnAtTick !== w.respawnAtTick) {
          records.push({
            kind: "delta",
            entityId: e.id,
            pool: w.pool,
            accumulator: w.accumulator,
            respawnAtTick: w.respawnAtTick,
          });
        }
        this.nodeSeen.set(e.id, { pool: w.pool, accumulator: w.accumulator, respawnAtTick: w.respawnAtTick });
      } else if (e.kind === "corpse") {
        const c = e as CorpseEntity;
        if (!this.globalSent.has(e.id)) {
          records.push({
            kind: "spawn",
            entityId: e.id,
            kindTag: "corpse",
            position: { x: c.position.x, y: c.position.y, z: c.position.z },
            inventory: c.inventory,
          });
        } else {
          records.push({
            kind: "delta",
            entityId: e.id,
            position: { x: c.position.x, y: c.position.y, z: c.position.z },
          });
        }
      } else if (e.kind === "ground_item") {
        const g = e as GroundItemEntity;
        if (!this.globalSent.has(e.id)) {
          records.push({
            kind: "spawn",
            entityId: e.id,
            kindTag: "ground_item",
            position: { x: g.position.x, y: g.position.y, z: g.position.z },
            stack: g.stack,
            despawnAtTick: g.despawnAtTick,
          });
        } else {
          records.push({
            kind: "delta",
            entityId: e.id,
            stack: g.stack,
          });
        }
      } else if (e.kind === "structure") {
        const st = e as import("@dustfall/sim").StructureEntity;
        const craftState = st.craft ?? null;
        if (!this.globalSent.has(e.id)) {
          records.push({
            kind: "spawn",
            entityId: e.id,
            kindTag: "structure",
            contentId: st.contentId,
            position: { x: st.position.x, y: st.position.y, z: st.position.z },
            ownerId: st.ownerId,
            hp: st.hp,
            craft: st.craft ?? undefined,
          });
        } else {
          const seenCraft = this.structureSeen.get(e.id) ?? null;
          const same =
            seenCraft === null
              ? craftState === null
              : craftState !== null &&
                seenCraft.recipeId === craftState.recipeId &&
                seenCraft.completesAtTick === craftState.completesAtTick &&
                seenCraft.startedBy === craftState.startedBy;
          if (!same) {
            records.push({
              kind: "delta",
              entityId: e.id,
              craft: st.craft ?? undefined, // undefined when idle: clear the client's bar
            });
          }
        }
        this.structureSeen.set(e.id, craftState);
      }
      this.globalSent.add(e.id);
    }

    // entities sent before but removed from the store (corpse fully looted,
    // ground item consumed) must be forgotten on the wire (GDD §21.7)
    for (const id of this.globalSent) {
      if (!this.store.has(id as import("@dustfall/contracts").EntityId)) {
        records.push({ kind: "forget", entityId: id });
        this.globalSent.delete(id);
      }
    }

    // authoritative events since the last batch (§21.7: never dropped)
    const evs = this.pendingEvents;
    this.pendingEvents = [];
    for (const ev of evs) {
      for (const g of ev.gathered) {
        records.push({ kind: "event", entityId: g.nodeEntityId, event: "gather", payload: { playerId: g.playerId, payout: g.payout, secondaries: g.secondaries, depleted: g.depleted } });
      }
      for (const d of ev.deaths) {
        records.push({ kind: "event", event: "death", payload: { playerId: d.playerId, corpseEntityId: d.corpseEntityId, tick: d.tick } });
      }
      for (const inv of ev.inventory) {
        records.push({ kind: "event", event: "inventory", payload: { playerId: inv.playerId, kind: inv.kind, ok: inv.ok, touched: inv.touched, taken: inv.taken ?? [] } });
      }
      for (const nid of ev.respawnedNodes) {
        records.push({ kind: "event", entityId: nid, event: "node_respawn", payload: {} });
      }
      for (const gid of ev.despawnedGround) {
        records.push({ kind: "event", event: "ground_despawn", payload: { entityId: gid } });
        records.push({ kind: "forget", entityId: gid });
      }
      // M3 authoritative events
      for (const c of ev.crafted) {
        records.push({
          kind: "event",
          entityId: c.structureEntityId,
          event: "craft",
          payload: { playerId: c.playerId, recipeId: c.recipeId, itemId: c.itemId, quantity: c.quantity, dropped: c.dropped },
        });
      }
      for (const r of ev.researched) {
        records.push({ kind: "event", event: "blueprint", payload: { playerId: r.playerId, payload: r.payload } });
      }
      for (const pl of ev.placed) {
        records.push({ kind: "event", entityId: pl.structureEntityId, event: "build", payload: { playerId: pl.playerId, contentId: pl.contentId } });
      }
    }

    // the shared records are sent to every ready session, but each session's
    // own body delta carries its live inventory grid (the client only ever
    // sees its own inventory — never another player's, GDD §22)
    for (const [sessionId, writer] of this.writers) {
      const s = this.sessions.get(sessionId);
      if (!s || s.state !== "ready") continue;
      const own = this.playerFor(s);
      const recs: SnapshotProto["records"] = [...records];
      // every live player's body (position/vitals); inventory only on own record
      for (const e of this.store.values()) {
        const p = e as PlayerEntity;
        if (p.kind !== "player" || p.dead) continue;
        const isOwn = p.id === own?.id;
        const rec: SnapshotProto["records"][number] = {
          kind: "delta",
          entityId: p.id,
          playerId: p.playerId,
          position: { x: Math.round(p.position.x), y: Math.round(p.position.y), z: Math.round(p.position.z) },
          yawHundredths: p.yawHundredths,
          pitchHundredths: p.pitchHundredths,
          health: Math.round(p.vitals.health),
          calories: Math.round(p.vitals.calories),
          posture: p.posture,
        };
        if (isOwn) rec.inventory = p.inventory;
        recs.push(rec);
      }
      const snapshot: SnapshotProto = {
        protocol: 1,
        serverTick: this.world.clock.tick,
        batchSequence: this.batchSequence,
        ackInputSequence: 0,
        baselineId: this.baselineId,
        records: recs,
      };
      const payload = encode(snapshot);
      s.queuedBytes += payload.byteLength;
      writer(Buffer.from(payload), true);
    }
    this.batchSequence += 1;
  }

  // ------------------------------------------------------------------
  // baseline + spawning
  // ------------------------------------------------------------------

  /** Full world baseline for the session (GDD §21.7: full on join, then deltas). */
  private sendBaseline(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    const seen = session.seen;
    const records: SnapshotProto["records"] = [];
    for (const e of this.store.values()) {
      seen.add(e.id);
      if (e.kind === "player") {
        const p = e as PlayerEntity;
        if (p.dead && p.playerId === session.playerId) continue; // dead self: death overlay, no body
        const isSelf = p.playerId === session.playerId;
        const rec: SnapshotProto["records"][number] = {
          kind: "spawn",
          entityId: p.id,
          kindTag: "player",
          playerId: p.playerId,
          position: { x: Math.round(p.position.x), y: Math.round(p.position.y), z: Math.round(p.position.z) },
        };
        // msgpack encodes undefined as null: only set keys that are present
        if (isSelf) {
          rec.health = Math.round(p.vitals.health);
          rec.inventory = p.inventory;
          if (p.blueprints.length > 0) rec.blueprints = p.blueprints;
        }
        records.push(rec);
      } else if (e.kind === "world") {
        const w = e as WorldEntity;
        records.push({
          kind: "spawn",
          entityId: e.id,
          kindTag: "world",
          position: { x: w.position.x, y: w.position.y, z: w.position.z },
          contentId: w.contentId,
          pool: w.pool,
          accumulator: w.accumulator,
          respawnAtTick: w.respawnAtTick,
        });
        this.nodeSeen.set(e.id, { pool: w.pool, accumulator: w.accumulator, respawnAtTick: w.respawnAtTick });
      } else if (e.kind === "corpse") {
        const c = e as CorpseEntity;
        records.push({
          kind: "spawn",
          entityId: e.id,
          kindTag: "corpse",
          position: { x: c.position.x, y: c.position.y, z: c.position.z },
          inventory: c.inventory,
        });
      } else if (e.kind === "ground_item") {
        const g = e as GroundItemEntity;
        records.push({
          kind: "spawn",
          entityId: e.id,
          kindTag: "ground_item",
          position: { x: g.position.x, y: g.position.y, z: g.position.z },
          stack: g.stack,
          despawnAtTick: g.despawnAtTick,
        });
      } else if (e.kind === "structure") {
        const st = e as import("@dustfall/sim").StructureEntity;
        const rec: SnapshotProto["records"][number] = {
          kind: "spawn",
          entityId: e.id,
          kindTag: "structure",
          contentId: st.contentId,
          position: { x: st.position.x, y: st.position.y, z: st.position.z },
          ownerId: st.ownerId,
          hp: st.hp,
        };
        if (st.craft) rec.craft = st.craft;
        records.push(rec);
        this.structureSeen.set(e.id, st.craft ?? null);
      }
    }
    const snapshot: SnapshotProto = {
      protocol: 1,
      serverTick: this.world.clock.tick,
      batchSequence: this.batchSequence,
      ackInputSequence: 0,
      baselineId: this.baselineId,
      records,
    };
    session.baselineId = this.baselineId;
    this.batchSequence += 1;
    for (const e of this.store.values()) this.globalSent.add(e.id);
    const writer = this.writers.get(sessionId);
    if (writer) writer(Buffer.from(encode(snapshot)), true);
  }

  /**
   * Spawn the player entity at the first spawn point of Bootheel Landing.
   * Starter kit: Rock, Torch, two Bandages (GDD §3).
   */
  private spawnPlayerEntity(playerId: string): EntityId {
    const region = REGIONS.find((r) => r.id === "region_bootheel_landing");
    const spawnPoint = region?.spawnPoints[0] ?? { x: 0, y: 0, z: 0 };
    const id = this.store.allocate();
    const p = newPlayer(id, playerId as PlayerId, {
      x: Math.round(spawnPoint.x * 100),
      y: 0,
      z: Math.round(spawnPoint.z * 100),
    });
    this.store.insert(p);
    p.inventory[0] = { itemId: "rock" as ItemId, quantity: 1 };
    p.inventory[1] = { itemId: "torch" as ItemId, quantity: 1 };
    p.inventory[2] = { itemId: "bandage" as ItemId, quantity: 2 };
    p.inventory[28] = { itemId: "rock" as ItemId, quantity: 1 };
    p.inventory[29] = { itemId: "torch" as ItemId, quantity: 1 };
    p.heldItemId = p.inventory[0]?.itemId ?? null;
    return id;
  }

  /** Respawn a dead player entity at spawn with the starter kit. */
  private respawnEntity(p: PlayerEntity): void {
    const region = REGIONS.find((r) => r.id === "region_bootheel_landing");
    const spawnPoint = region?.spawnPoints[0] ?? { x: 0, y: 0, z: 0 };
    p.position = { x: Math.round(spawnPoint.x * 100), y: 0, z: Math.round(spawnPoint.z * 100) };
    p.prevPosition = { ...p.position };
    p.velocityY = 0;
    p.dead = false;
    p.deadTicks = 0;
    p.yawHundredths = 0;
    p.pitchHundredths = 0;
    p.posture = "standing";
    p.vitals = freshVitals();
    p.inventory = new Array(36).fill(null);
    p.inventory[0] = { itemId: "rock" as ItemId, quantity: 1 };
    p.inventory[1] = { itemId: "torch" as ItemId, quantity: 1 };
    p.inventory[2] = { itemId: "bandage" as ItemId, quantity: 2 };
    p.inventory[28] = { itemId: "rock" as ItemId, quantity: 1 };
    p.inventory[29] = { itemId: "torch" as ItemId, quantity: 1 };
    p.heldItemId = p.inventory[0]?.itemId ?? null;
  }

  /**
   * Gateway hook: a socket closed. Marks the session disconnected so a
   * reconnect within 5 minutes can resume it (GDD §22.4). The player
   * entity stays in the world (Sleeper policy, §22.5).
   */
  onDisconnect(sessionId: string): void {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    s.lastDisconnectAtMs = Date.now();
    this.issuedTokens.delete(sessionId);
  }

  /** Gateway hook: a session was fully removed (duplicate identity / kick). */
  removeSession(sessionId: string): void {
    this.sessions.remove(sessionId);
    this.issuedTokens.delete(sessionId);
    this.writers.delete(sessionId);
  }

  // ------------------------------------------------------------------
  // persistence bridge (GDD §21): WorldSave <-> live world
  // ------------------------------------------------------------------

  /**
   * Serialize the live world into a WorldSave document. Called by the host
   * persistence layer before an atomic save (autosave + clean shutdown).
   */
  toSaveDocument(): import("@dustfall/persistence").WorldSave {
    const c = this.world.clock;
    const players: import("@dustfall/persistence").PlayerSave[] = [];
    for (const e of this.store.values()) {
      if (e.kind !== "player") continue;
      const p = e as PlayerEntity;
      players.push({
        playerId: p.playerId,
        blueprints: [...p.blueprints],
        inventory: p.inventory.map((s) => (s ? { ...s } : null)),
        equipment: p.equipment,
        position: { ...p.position },
        vitals: p.vitals,
        lastSeenTick: c.tick,
      });
    }
    const entities: import("@dustfall/persistence").EntitySave[] = [];
    for (const e of this.store.values()) {
      if (e.kind === "world") {
        const w = e as WorldEntity;
        entities.push({
          entityId: w.id,
          kind: "world",
          contentId: w.contentId,
          position: { ...w.position },
          pool: w.pool,
          payload: { accumulator: w.accumulator, respawnAtTick: w.respawnAtTick },
        });
      } else if (e.kind === "corpse") {
        const c2 = e as CorpseEntity;
        entities.push({
          entityId: c2.id,
          kind: "corpse",
          contentId: "corpse",
          position: { ...c2.position },
          pool: 0,
          payload: { inventory: c2.inventory.map((s) => (s ? { ...s } : null)) },
        });
      } else if (e.kind === "ground_item") {
        const g = e as GroundItemEntity;
        entities.push({
          entityId: g.id,
          kind: "ground_item",
          contentId: "ground_item",
          position: { ...g.position },
          pool: 0,
          payload: { stack: { ...g.stack }, despawnAtTick: g.despawnAtTick },
        });
      } else if (e.kind === "structure") {
        const st = e as import("@dustfall/sim").StructureEntity;
        entities.push({
          entityId: st.id,
          kind: "structure",
          contentId: st.contentId,
          position: { ...st.position },
          pool: 0,
          payload: { ownerId: st.ownerId, hp: st.hp, maxHp: st.maxHp },
        });
      }
    }
    return {
      schemaVersion: 1,
      worldId: this.world.worldId,
      seed: `${this.world.seedA},${this.world.seedB}`,
      serverSettings: {},
      clock: { tick: c.tick, gameSeconds: c.gameSecondsOfDay, weather: this.world.weather, weatherSeed: this.world.seedB },
      players,
      entities,
      crews: [],
      lootState: [],
      migrationsApplied: [],
      lastSavedAt: new Date().toISOString(),
    };
  }

  /**
   * Restore a persisted world into the live store + clock. Replaces all
   * world/corpse/ground entities; merges saved state into live player
   * entities (matched by PlayerId) or creates dormant bodies for players
   * that are not currently connected. Reseeds the EntityStore id counter
   * past the largest restored id so fresh allocations never collide.
   */
  restoreFromSave(doc: import("@dustfall/persistence").WorldSave): void {
    this.world.clock = {
      tick: doc.clock.tick,
      gameSecondsOfDay: doc.clock.gameSeconds,
      day: Math.floor(doc.clock.tick / 108_000),
    };

    // clear non-player entities (live players stay; their state is merged)
    for (const e of this.store.values()) {
      if (e.kind !== "player") this.store.remove(e.id);
    }
    this.nodeSeen.clear();

    const restoredIds: string[] = [];
    for (const es of doc.entities) {
      const id = es.entityId as import("@dustfall/contracts").EntityId;
      const position = { ...es.position };
      if (es.kind === "world") {
        const w: WorldEntity = {
          id,
          kind: "world",
          contentId: es.contentId,
          position,
          pool: es.pool,
          accumulator: es.payload?.accumulator ?? 0,
          respawnAtTick: es.payload?.respawnAtTick ?? 0,
        };
        this.store.insert(w);
        this.nodeSeen.set(w.id, { pool: w.pool, accumulator: w.accumulator, respawnAtTick: w.respawnAtTick });
        restoredIds.push(es.entityId);
      } else if (es.kind === "corpse") {
        const c2: CorpseEntity = {
          id,
          kind: "corpse",
          position,
          inventory: (es.payload?.inventory ?? []).map((s) => (s ? { ...s } : null)),
        };
        this.store.insert(c2);
        restoredIds.push(es.entityId);
      } else if (es.kind === "ground_item") {
        const stack = es.payload?.stack;
        if (!stack) continue;
        const g: GroundItemEntity = {
          id,
          kind: "ground_item",
          position,
          stack: { ...stack },
          despawnAtTick: es.payload?.despawnAtTick ?? 0,
        };
        this.store.insert(g);
        restoredIds.push(es.entityId);
      } else if (es.kind === "structure") {
        const st: import("@dustfall/sim").StructureEntity = {
          id,
          kind: "structure",
          contentId: es.contentId,
          position,
          ownerId: es.payload?.ownerId ?? "",
          craft: null, // in-flight station craft does not survive a restart
          hp: es.payload?.hp ?? 100,
          maxHp: es.payload?.maxHp ?? 100,
        };
        this.store.insert(st);
        this.structureSeen.set(st.id, null);
        restoredIds.push(es.entityId);
      }
    }

    for (const ps of doc.players) {
      const live = this.playerForPlayerId(ps.playerId);
      if (live) {
        live.position = { ...ps.position };
        live.prevPosition = { ...ps.position };
        live.vitals = ps.vitals;
        live.blueprints = [...ps.blueprints];
        live.equipment = ps.equipment;
        live.inventory = ps.inventory.map((s) => (s ? { ...s } : null));
      } else {
        const id = this.store.allocate();
        const p = newPlayer(id, ps.playerId as PlayerId, { ...ps.position });
        p.vitals = ps.vitals;
        p.blueprints = [...ps.blueprints];
        p.equipment = ps.equipment;
        p.inventory = ps.inventory.map((s) => (s ? { ...s } : null));
        this.store.insert(p);
        restoredIds.push(p.id);
      }
    }

    this.store.setNextIdAfter(restoredIds);
    for (const id of restoredIds) this.globalSent.add(id);
  }

  private playerForPlayerId(playerId: string): PlayerEntity | undefined {
    for (const e of this.store.values()) {
      if (e.kind === "player" && e.playerId === playerId) return e as PlayerEntity;
    }
    return undefined;
  }

  get maxBackpressureBytes(): number {
    return BACKPRESSURE_QUEUE_BYTES;
  }

  get backpressureWindowMs(): number {
    return BACKPRESSURE_WINDOW_S * 1000;
  }

  // ------------------------------------------------------------------
  // wire helpers
  // ------------------------------------------------------------------

  private sendJson(sessionId: string, obj: unknown): void {
    const writer = this.writers.get(sessionId);
    if (writer) writer(Buffer.from(JSON.stringify(obj)), false);
  }

  private parseJwk(v: unknown): import("@dustfall/protocol").JwkProto | null {
    if (typeof v !== "object" || v === null) return null;
    const o = v as Record<string, unknown>;
    if (o.kty !== "EC" || o.crv !== "P-256") return null;
    if (typeof o.x !== "string" || typeof o.y !== "string") return null;
    if (o.x.length < 43 || o.x.length > 44 || o.y.length < 43 || o.y.length > 44) return null;
    const jwk: import("@dustfall/protocol").JwkProto = { kty: "EC", crv: "P-256", x: o.x, y: o.y };
    if (o.alg === "ES256") jwk.alg = "ES256";
    return jwk;
  }
}
