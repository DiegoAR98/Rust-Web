/**
 * Client replica store: read-only copy of authoritative state (GDD §21.4).
 * Confirmed values come from the replica store only.
 *
 * M2: players carry their playerId (the client finds "me" by the grant's
 * playerId, not by being first), and events (gather/death/inventory/
 * node_respawn/ground_despawn) are surfaced so the UI can react.
 */
import type { SnapshotProto, ItemStackProto } from "@dustfall/protocol";

export interface ReplicaPlayer {
  entityId: string;
  /** stable player id (matches the session grant's playerId) */
  playerId: string;
  x: number;
  y: number;
  z: number;
  yawHundredths: number;
  pitchHundredths: number;
  health: number;
  calories: number;
  posture: "standing" | "crouching";
  /**
   * Live inventory grid — only populated on the local player's own deltas
   * (the server sends inventory exclusively to the owner, GDD §22).
   */
  inventory?: (ItemStackProto | null)[];
  /** M3: blueprint payloads the local player owns */
  blueprints?: string[];
  /** M3: in-flight hand-craft (own deltas only) */
  handCraft: { recipeId: string; completesAtTick: number } | null;
}

export interface ReplicaNode {
  entityId: string;
  contentId: string | undefined;
  x: number;
  y: number;
  z: number;
  pool: number;
  accumulator: number;
  respawnAtTick: number | null;
}

export interface ReplicaCorpse {
  entityId: string;
  x: number;
  y: number;
  z: number;
  /** total items inside */
  itemCount: number;
}

export interface ReplicaGround {
  entityId: string;
  x: number;
  y: number;
  z: number;
  itemId: string;
  quantity: number;
  despawnAtTick: number;
}

export interface ReplicaStructure {
  entityId: string;
  contentId: string | undefined;
  x: number;
  y: number;
  z: number;
  ownerId: string | undefined;
  hp: number | undefined;
  /** active station craft, if any */
  craft: { recipeId: string; completesAtTick: number; startedBy: string } | null;
}

export interface ReplicaEvent {
  event: string;
  entityId: string | undefined;
  payload: Record<string, unknown>;
}

export class Replica {
  readonly players = new Map<string, ReplicaPlayer>();
  readonly nodes = new Map<string, ReplicaNode>();
  readonly corpses = new Map<string, ReplicaCorpse>();
  readonly ground = new Map<string, ReplicaGround>();
  readonly structures = new Map<string, ReplicaStructure>();
  /** events since the last time the UI drained them */
  private pendingEvents: ReplicaEvent[] = [];
  serverTick = 0;

  /** entity id of the player body for a given playerId */
  entityForPlayer(playerId: string): string | undefined {
    for (const [id, p] of this.players) if (p.playerId === playerId) return id;
    return undefined;
  }

  drainEvents(): ReplicaEvent[] {
    const out = this.pendingEvents;
    this.pendingEvents = [];
    return out;
  }

  apply(snapshot: SnapshotProto): void {
    this.serverTick = snapshot.serverTick;
    for (const rec of snapshot.records) {
      if (rec.kind === "spawn") {
        this.applySpawn(rec);
      } else if (rec.kind === "delta") {
        this.applyDelta(rec);
      } else if (rec.kind === "event") {
        this.pendingEvents.push({ event: rec.event, entityId: rec.entityId, payload: rec.payload as Record<string, unknown> });
      } else if (rec.kind === "forget") {
        this.players.delete(rec.entityId);
        this.nodes.delete(rec.entityId);
        this.corpses.delete(rec.entityId);
        this.ground.delete(rec.entityId);
        this.structures.delete(rec.entityId);
      }
    }
  }

  private applySpawn(rec: Extract<SnapshotProto["records"][number], { kind: "spawn" }>): void {
    const pos = rec.position;
    if (rec.kindTag === "player") {
      const prev = this.players.get(rec.entityId);
      this.players.set(rec.entityId, {
        entityId: rec.entityId,
        playerId: rec.playerId ?? prev?.playerId ?? "",
        x: pos.x,
        y: pos.y,
        z: pos.z,
        yawHundredths: 0,
        pitchHundredths: 0,
        health: rec.health ?? prev?.health ?? 100,
        calories: prev?.calories ?? 1500,
        posture: prev?.posture ?? "standing",
        handCraft: rec.handCraft ?? null,
      });
    } else if (rec.kindTag === "world") {
      this.nodes.set(rec.entityId, {
        entityId: rec.entityId,
        contentId: rec.contentId,
        x: pos.x,
        y: pos.y,
        z: pos.z,
        pool: rec.pool ?? 0,
        accumulator: rec.accumulator ?? 0,
        respawnAtTick: rec.respawnAtTick ?? null,
      });
    } else if (rec.kindTag === "corpse") {
      this.corpses.set(rec.entityId, {
        entityId: rec.entityId,
        x: pos.x,
        y: pos.y,
        z: pos.z,
        itemCount: (rec.inventory ?? []).reduce((n, s) => n + (s?.quantity ?? 0), 0),
      });
    } else if (rec.kindTag === "ground_item") {
      this.ground.set(rec.entityId, {
        entityId: rec.entityId,
        x: pos.x,
        y: pos.y,
        z: pos.z,
        itemId: rec.stack?.itemId ?? "?",
        quantity: rec.stack?.quantity ?? 0,
        despawnAtTick: rec.despawnAtTick ?? 0,
      });
    } else if (rec.kindTag === "structure") {
      this.structures.set(rec.entityId, {
        entityId: rec.entityId,
        contentId: rec.contentId,
        x: pos.x,
        y: pos.y,
        z: pos.z,
        ownerId: rec.ownerId,
        hp: rec.hp,
        craft: rec.craft ?? null,
      });
    }
  }

  private applyDelta(rec: Extract<SnapshotProto["records"][number], { kind: "delta" }>): void {
    const p = this.players.get(rec.entityId);
    if (p) {
      if (rec.position) {
        p.x = rec.position.x;
        p.y = rec.position.y;
        p.z = rec.position.z;
      }
      if (rec.yawHundredths !== undefined) p.yawHundredths = rec.yawHundredths;
      if (rec.pitchHundredths !== undefined) p.pitchHundredths = rec.pitchHundredths;
      if (rec.health !== undefined) p.health = rec.health;
      if (rec.calories !== undefined) p.calories = rec.calories;
      if (rec.posture !== undefined) p.posture = rec.posture;
      if (rec.playerId) p.playerId = rec.playerId;
      if (rec.inventory) p.inventory = rec.inventory;
      if (rec.blueprints) p.blueprints = rec.blueprints;
      if (rec.handCraft) p.handCraft = rec.handCraft;
      else p.handCraft = null; // explicit clear when the craft finishes
      return;
    }
    const node = this.nodes.get(rec.entityId);
    if (node) {
      if (rec.position) {
        node.x = rec.position.x;
        node.y = rec.position.y;
        node.z = rec.position.z;
      }
      if (rec.pool !== undefined) node.pool = rec.pool;
      if (rec.accumulator !== undefined) node.accumulator = rec.accumulator;
      if (rec.respawnAtTick !== undefined) node.respawnAtTick = rec.respawnAtTick;
      return;
    }
    const corpse = this.corpses.get(rec.entityId);
    if (corpse && rec.position) {
      corpse.x = rec.position.x;
      corpse.y = rec.position.y;
      corpse.z = rec.position.z;
      return;
    }
    const g = this.ground.get(rec.entityId);
    if (g) {
      if (rec.position) {
        g.x = rec.position.x;
        g.y = rec.position.y;
        g.z = rec.position.z;
      }
      if (rec.stack) {
        g.itemId = rec.stack.itemId;
        g.quantity = rec.stack.quantity;
      }
      return;
    }
    const st = this.structures.get(rec.entityId);
    if (st) {
      if (rec.position) {
        st.x = rec.position.x;
        st.y = rec.position.y;
        st.z = rec.position.z;
      }
      if (rec.craft) st.craft = rec.craft;
      else st.craft = null; // explicit clear when the station goes idle
      return;
    }
  }
}
