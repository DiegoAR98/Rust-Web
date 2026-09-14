/**
 * Client replica store: read-only copy of authoritative state (GDD §21.4).
 * Confirmed values come from the replica store only.
 */
import type { SnapshotProto } from "@dustfall/protocol";

export interface ReplicaPlayer {
  entityId: string;
  x: number;
  y: number;
  z: number;
  yawHundredths: number;
  pitchHundredths: number;
  health: number;
  calories: number;
  posture: "standing" | "crouching";
}

export class Replica {
  readonly players = new Map<string, ReplicaPlayer>();
  serverTick = 0;

  apply(snapshot: SnapshotProto): void {
    this.serverTick = snapshot.serverTick;
    for (const rec of snapshot.records) {
      if (rec.kind === "spawn") {
        this.players.set(rec.entityId, {
          entityId: rec.entityId,
          x: rec.position.x,
          y: rec.position.y,
          z: rec.position.z,
          yawHundredths: 0,
          pitchHundredths: 0,
          health: 100,
          calories: 1500,
          posture: "standing",
        });
      } else if (rec.kind === "delta") {
        const p = this.players.get(rec.entityId);
        if (!p) continue;
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
      } else if (rec.kind === "forget") {
        this.players.delete(rec.entityId);
      }
      // event records: M1 ignores
    }
  }
}
