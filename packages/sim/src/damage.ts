/**
 * M6: damage formula + armor (GDD §11, backlog M6-02).
 *
 * `finalDamage = baseDamage × falloff × zoneMultiplier × (1 - clamp(sumArmorReduction, 0, 0.60))`
 *
 * - falloff: linear between `falloffStartM` (×1.0) and `falloffEndM` (×0.25);
 *   1.0 before the start, 0.25 at/after the end. No falloff (startM=0) when
 *   both are zero.
 * - zoneMultiplier: head ×1.5, limb ×0.75, torso ×1 (from TUNING).
 * - Armor reductions are summed across all worn pieces (not just the struck
 *   slot) and clamped at 0.60 (GDD §11).
 *
 * Result is a whole hp number (rounded, GDD §21.5: damage is integer).
 */
import { TUNING } from "@dustfall/content";
import { zoneMultiplier, type HitZone } from "./hitbox.js";

export interface ArmorItem {
  damageReduction: number;
}

/** Sum of armor reductions across worn pieces, clamped to [0, 0.60]. */
export const armorReduction = (worn: readonly ArmorItem[], maxClamp = Number(TUNING["combat.max_armor_reduction"] ?? 0.6)): number => {
  const sum = worn.reduce((s, a) => s + a.damageReduction, 0);
  return Math.min(Math.max(sum, 0), maxClamp);
};

/**
 * Linear falloff in [0.25, 1.0] by distance (meters).
 * dist <= startM → 1.0; dist >= endM → 0.25; linear between.
 * When startM === 0 && endM === 0: no falloff (always 1.0).
 */
export const falloffMultiplier = (distanceM: number, falloffStartM: number, falloffEndM: number): number => {
  if (falloffStartM <= 0 && falloffEndM <= 0) return 1;
  if (distanceM <= falloffStartM) return 1;
  if (distanceM >= falloffEndM) return 0.25;
  const t = (distanceM - falloffStartM) / (falloffEndM - falloffStartM);
  return 1 - t * 0.75; // 1.0 → 0.25
};

export interface DamageParams {
  baseDamage: number;
  distanceM: number;
  falloffStartM: number;
  falloffEndM: number;
  zone: HitZone;
  wornArmor: readonly ArmorItem[];
}

/** Apply the full GDD §11 damage formula; returns whole hp. */
export const computeDamage = (p: DamageParams): number => {
  const falloff = falloffMultiplier(p.distanceM, p.falloffStartM, p.falloffEndM);
  const zoneMult = zoneMultiplier(p.zone);
  const armor = armorReduction(p.wornArmor);
  const raw = p.baseDamage * falloff * zoneMult * (1 - armor);
  return Math.max(1, Math.round(raw));
};
