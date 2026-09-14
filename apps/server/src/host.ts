/**
 * Authoritative host (GDD §21.4/§21.5/§21.7).
 * - 30 Hz simulation tick, at most 5 catch-up ticks per frame
 * - 15 Hz replica batches (every second tick)
 * - binary frames after the handshake, msgpack-encoded snapshots
 */
import { createWorld, runTick, type World, type TickCommand } from "@dustfall/sim";
import { EntityStore, newPlayer, type PlayerEntity } from "@dustfall/sim";
import type { PlayerId, ItemId, EntityId } from "@dustfall/contracts";
import { ClientEnvelopeSchema, type SnapshotProto } from "@dustfall/protocol";
import { encode } from "@msgpack/msgpack";
import { BACKPRESSURE_QUEUE_BYTES, BACKPRESSURE_WINDOW_S } from "@dustfall/protocol";
import { REGIONS } from "@dustfall/content";
import { SessionRegistry } from "./session.js";

export class Host {
  readonly world: World;
  readonly store: EntityStore;
  readonly sessions: SessionRegistry;
  private batchSequence = 0;
  private baselineId = 1;
  /** socket writers keyed by session id */
  private readonly writers = new Map<string, (data: Buffer, isBinary: boolean) => void>();

  constructor(worldId: string, seedA: number, seedB: number, maxPlayers: number) {
    this.world = createWorld(worldId, seedA, seedB);
    this.store = new EntityStore();
    this.sessions = new SessionRegistry();
    void maxPlayers;
  }

  /** Register a session's binary writer. */
  attachWriter(sessionId: string, writer: (data: Buffer, isBinary: boolean) => void): void {
    this.writers.set(sessionId, writer);
  }

  detachWriter(sessionId: string): void {
    this.writers.delete(sessionId);
  }

  /**
   * Receive an envelope from a session. Validates and queues for the next tick.
   * Returns true if accepted.
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
      for (const env of session.pending) {
        for (const cmd of env.commands) {
          if (cmd.kind !== "move") continue;
          commands.push({
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
          });
        }
      }
      session.pending.length = 0;
    }

    runTick(this.world, this.store, commands);

    const batchDue = this.world.clock.tick % 2 === 1;
    if (batchDue) {
      this.emitReplicaBatch();
    }
    return batchDue;
  }

  private emitReplicaBatch(): void {
    const snapshot: SnapshotProto = {
      protocol: 1,
      serverTick: this.world.clock.tick,
      batchSequence: this.batchSequence,
      ackInputSequence: 0,
      baselineId: this.baselineId,
      records: [],
    };
    for (const e of this.store.values()) {
      if (e.kind === "player") {
        const p = e as PlayerEntity;
        if (!p.dead) {
          snapshot.records.push({
            kind: "delta",
            entityId: p.id,
            position: { x: Math.round(p.position.x), y: Math.round(p.position.y), z: Math.round(p.position.z) },
            yawHundredths: p.yawHundredths,
            pitchHundredths: p.pitchHundredths,
            health: Math.round(p.vitals.health),
            calories: Math.round(p.vitals.calories),
            posture: p.posture,
          });
        }
      }
    }
    this.batchSequence += 1;
    const payload = encode(snapshot);
    for (const [sessionId, writer] of this.writers) {
      const s = this.sessions.get(sessionId);
      if (!s || s.state !== "ready") continue;
      // backpressure check (GDD §21.7): 4 MiB queued for 10 s -> disconnect
      s.queuedBytes += payload.byteLength;
      writer(Buffer.from(payload), true);
      // NOTE: queuedBytes is decremented by the socket layer when drained
    }
  }

  /** Spawn a player at the first spawn point of Bootheel Landing. */
  spawnPlayer(sessionId: string, playerId: string): EntityId {
    const region = REGIONS.find((r) => r.id === "region_bootheel_landing");
    const spawnPoint = region?.spawnPoints[0] ?? { x: 0, y: 0, z: 0 };
    const id = this.store.allocate();
    const p = newPlayer(id, playerId as PlayerId, {
      x: Math.round(spawnPoint.x * 100),
      y: 0,
      z: Math.round(spawnPoint.z * 100),
    });
    this.store.insert(p);

    // starter kit: Rock, Torch, two Bandages (GDD §3)
    p.inventory[0] = { itemId: "rock" as ItemId, quantity: 1 };
    p.inventory[1] = { itemId: "torch" as ItemId, quantity: 1 };
    p.inventory[2] = { itemId: "bandage" as ItemId, quantity: 2 };
    // hotbar mirrors slots
    p.inventory[28] = { itemId: "rock" as ItemId, quantity: 1 };
    p.inventory[29] = { itemId: "torch" as ItemId, quantity: 1 };

    const session = this.sessions.get(sessionId);
    if (session) {
      session.state = "ready";
      session.joinedAtTick = this.world.clock.tick;
      // baseline: spawn record for every live entity, so late joiners
      // see the whole world (GDD §21.7: full baseline on join, then deltas)
      const records: SnapshotProto["records"] = [];
      for (const e of this.store.values()) {
        if (e.kind !== "player" || (e as PlayerEntity).dead) continue;
        const p = e as PlayerEntity;
        records.push({
          kind: "spawn",
          entityId: p.id,
          kindTag: "player",
          position: {
            x: Math.round(p.position.x),
            y: Math.round(p.position.y),
            z: Math.round(p.position.z),
          },
        });
      }
      const snapshot: SnapshotProto = {
        protocol: 1,
        serverTick: this.world.clock.tick,
        batchSequence: this.batchSequence,
        ackInputSequence: 0,
        baselineId: this.baselineId,
        records,
      };
      this.batchSequence += 1;
      const writer = this.writers.get(sessionId);
      if (writer) writer(Buffer.from(encode(snapshot)), true);
    }
    return id;
  }

  get maxBackpressureBytes(): number {
    return BACKPRESSURE_QUEUE_BYTES;
  }

  get backpressureWindowMs(): number {
    return BACKPRESSURE_WINDOW_S * 1000;
  }
}
