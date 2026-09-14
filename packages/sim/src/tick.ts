/**
 * Fixed-tick simulation loop (GDD §21.5).
 * Tick order:
 *  1. drain and validate inbound commands
 *  2. session, spawn and respawn transitions
 *  3. player movement and posture
 *  4. interactions, gathering, inventory, crafting and building intents
 *  5. weapon fire, projectiles, fuses and hit resolution
 *  6. damage, death, corpse and destruction transitions
 *  7. survival, status effects, stations, node respawn, weather and decay
 *  8. AI perception/evidence, planning, movement and action intents
 *  9. process AI actions through the same authoritative handlers
 * 10. collect durable transactions, authoritative events and dirty components
 * 11. build per-client interest sets and replica batches
 * 12. advance tick exactly once
 */
import { advanceClock } from "./world.js";
import { applyMovement, type MovementIntent } from "./movement.js";
import { applyVitals } from "./vitals-sys.js";
import type { EntityStore, PlayerEntity } from "./entities.js";
import type { World } from "./world.js";

export interface TickCommand {
  playerId: string;
  sequence: number;
  intent: MovementIntent;
  yawHundredths: number;
  pitchHundredths: number;
}

export interface TickEvents {
  moved: { playerId: string; x: number; y: number; z: number }[];
  died: string[];
}

/**
 * Run one simulation tick. Commands are sorted by PlayerId then sequence
 * (GDD §21.5). Returns events for the replication layer.
 */
export const runTick = (world: World, store: EntityStore, commands: TickCommand[]): TickEvents => {
  // 1. sort by playerId, then sequence
  const sorted = [...commands].sort((a, b) => {
    if (a.playerId !== b.playerId) return a.playerId < b.playerId ? -1 : 1;
    return a.sequence - b.sequence;
  });

  const events: TickEvents = { moved: [], died: [] };

  for (const cmd of sorted) {
    const p = [...store.values()].find(
      (e): e is PlayerEntity => e.kind === "player" && e.playerId === (cmd.playerId as import("@dustfall/contracts").PlayerId),
    );
    if (!p || p.dead) continue;

    // 3. movement
    const moving = Math.abs(cmd.intent.wishX) > 1 || Math.abs(cmd.intent.wishZ) > 1;
    const sprinting = moving && cmd.intent.sprint;
    applyMovement(p, cmd.intent);
    p.yawHundredths = cmd.yawHundredths;
    p.pitchHundredths = cmd.pitchHundredths;
    events.moved.push({ playerId: p.playerId, x: p.position.x, y: p.position.y, z: p.position.z });

    // 7. survival
    applyVitals(p, moving, sprinting);

    if (p.dead) events.died.push(p.playerId);
  }

  // 12. advance tick exactly once
  advanceClock(world);
  return events;
};
