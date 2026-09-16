/**
 * M6: melee vs. a player (GDD §11 "Melee: animation-timed sphere check,
 * 1.5 m forward reach, first hit only").
 *
 * The swing path is the melee channel (tools carry no fire weapon; the
 * launch roster in GDD Appendix A is ranged + explosives). This mirrors
 * `hitAnimal` (M5) so melee is consistent across node / structure /
 * animal / player targets: reach + cooldown come from the gather tuning,
 * damage is `max(1, round(8 × toolMultiplier))`, and a dead player can
 * neither swing nor be swung again this tick.
 */
import type { World } from "./world.js";
import type { EntityStore, PlayerEntity } from "./entities.js";
import type { ItemId } from "@dustfall/contracts";
import { TUNING } from "@dustfall/content";
import { ITEMS } from "@dustfall/content";

export interface PlayerHitResult {
  ok: boolean;
  reason?: string;
  damage: number;
  killed: boolean;
}

const fail = (reason: string): PlayerHitResult => ({ ok: false, reason, damage: 0, killed: false });

/**
 * Resolve a melee swing against a player. Charges the shared swing cooldown
 * on any valid-target swing (same contract as node gathering + hitAnimal).
 */
export const hitPlayer = (world: World, store: EntityStore, p: PlayerEntity, playerId: string, toolMultiplier: number): PlayerHitResult => {
  if (p.dead) return fail("dead");
  const cooldown = TUNING["gather.swing_cooldown_ticks"] as number;
  if (world.clock.tick < p.swingCooldownUntilTick) return fail("cooldown");

  let victim: PlayerEntity | null = null;
  for (const e of store.values()) {
    if (e.kind !== "player") continue;
    const t = e as PlayerEntity;
    if (t.playerId !== playerId || t.dead) continue;
    victim = t;
    break;
  }
  if (!victim) return fail("unknown_player");

  const reachM = TUNING["gather.swing_reach_m"] as number;
  const dx = p.position.x - victim.position.x;
  const dz = p.position.z - victim.position.z;
  if (Math.sqrt(dx * dx + dz * dz) > reachM * 100) return fail("out_of_reach");

  p.swingCooldownUntilTick = world.clock.tick + cooldown;
  const dmg = Math.max(1, Math.round(8 * toolMultiplier));
  victim.vitals.health = Math.max(0, victim.vitals.health - dmg);
  // GDD §11: combat interrupts healing channels (M6-08)
  if (victim.channel) victim.channel = null;
  const killed = victim.vitals.health <= 0 && !victim.dead;
  if (killed) {
    victim.dead = true;
    victim.deadTicks = 0;
  }
  return { ok: true, damage: dmg, killed };
};

/** The held item's melee multiplier (bare hands = 0.5, GDD §11). */
export const heldToolMultiplier = (p: PlayerEntity): number => {
  if (!p.heldItemId) return 0.5;
  const slot = p.inventory.find((s) => s !== null && s !== undefined && s.itemId === p.heldItemId);
  const def = slot ? ITEMS.find((i) => i.id === (slot.itemId as ItemId)) : undefined;
  return def?.tool?.toolMultiplier ?? 0.5;
};
