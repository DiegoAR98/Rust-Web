/**
 * M5: radiation system (GDD §6, §15).
 *
 * Dose rates (rads per GAME second) are authored in content/schemas.ts
 * (RAD_DOSE_RATES), per band ring (rim / mid / core). The GDD's acceptance
 * tests T03/T04 are expressed in those units: "High core naked = 5.0 rads/s;
 * 500 rads in 100 s" — a player standing in the High core accumulates 5.0
 * rads per game second. Because the clock runs at 24× real time (ADR-0004),
 * that is 120 rads per real second at full dose: a naked Greywater run is a
 * real-time race, exactly the "timed raid-town" feel §6 asks for.
 *
 * Rules (GDD §6):
 * - Dose rates are NEVER summed across overlaps; the highest current ring
 *   wins.
 * - Worn armor reduces the dose: `final = base × (1 − clamp(protection, 0,
 *   0.9))`. A full Rad Suit blocks 90%.
 * - At 500 rads, radiation sickness becomes lethal without treatment: the
 *   sickness timer is armed and health drains until pills / food clear it.
 */
import { RAD_DOSE_RATES, RADIATION_ZONES, RAD_SICKNESS_THRESHOLD, type RadBand } from "@dustfall/content";
import type { EntityStore, PlayerEntity } from "./entities.js";
import type { World } from "./world.js";
import { GAME_SECONDS_PER_TICK } from "./world.js";
import { TUNING } from "@dustfall/content";

/** cm² from the zone center. */
const distSqCm = (px: number, pz: number, cx: number, cz: number): number => {
  const dx = px - cx * 100;
  const dz = pz - cz * 100;
  return dx * dx + dz * dz;
};

/**
 * The base dose rate (rads per game second) at a world position, in cm.
 * The highest ring the position falls in across all zones wins; 0 outside
 * every zone.
 */
export const doseRateAt = (posCm: { x: number; z: number }): number => {
  let best = 0;
  for (const zone of RADIATION_ZONES) {
    const d2 = distSqCm(posCm.x, posCm.z, zone.center.x, zone.center.z);
    const band = RAD_DOSE_RATES[zone.band];
    if (d2 <= zone.coreRadiusM * zone.coreRadiusM * 10000) {
      best = Math.max(best, band.core);
    } else if (d2 <= zone.midRadiusM * zone.midRadiusM * 10000) {
      best = Math.max(best, band.mid);
    } else if (d2 <= zone.rimRadiusM * zone.rimRadiusM * 10000) {
      best = Math.max(best, band.rim);
    }
  }
  return best;
};

/**
 * Total radiation protection 0..0.9 from worn armor (GDD §6: the Rad Suit
 * is the only piece with meaningful protection; values are summed but the
 * result is clamped so a player can never block more than 90%).
 */
export const radProtectionOf = (p: PlayerEntity): number => {
  let prot = 0;
  for (const eq of Object.values(p.equipment)) {
    if (!eq) continue;
    const def = eqDef(eq.itemId);
    prot += def?.armor?.radiationProtection ?? 0;
  }
  return Math.min(0.9, Math.max(0, prot));
};

// item defs are looked up lazily to keep this module import-light
import { ITEMS, type ItemDef } from "@dustfall/content";
const itemDefCache = new Map<string, ItemDef | undefined>();
const eqDef = (itemId: string): ItemDef | undefined => {
  if (!itemDefCache.has(itemId)) itemDefCache.set(itemId, ITEMS.find((i) => i.id === itemId));
  return itemDefCache.get(itemId);
};

export interface RadiationStepResult {
  /** rads accumulated this tick (after armor) */
  gained: number;
  /** rads after the step */
  total: number;
  /** true if sickness was (re)armed this tick */
  sicknessArmed: boolean;
}

/**
 * Apply one tick of radiation exposure to a player. Pure: mutates the
 * player's vitals; no RNG, no store access (zones are content-authored).
 */
export const applyRadiationTick = (_world: World, p: PlayerEntity): RadiationStepResult => {
  const base = doseRateAt({ x: p.position.x, z: p.position.z });
  if (base <= 0) {
    // no exposure; sickness still ticks in applyVitals if armed
    return { gained: 0, total: p.vitals.radiation, sicknessArmed: false };
  }
  const prot = radProtectionOf(p);
  const radsThisGameSecond = base * (1 - prot);
  const gained = radsThisGameSecond * GAME_SECONDS_PER_TICK;
  p.vitals.radiation = Math.min(RAD_SICKNESS_THRESHOLD, p.vitals.radiation + gained);

  let sicknessArmed = false;
  if (p.vitals.radiation >= RAD_SICKNESS_THRESHOLD) {
    if (p.vitals.radiationSicknessTimer <= 0) {
      // escalate: the timer marks "lethal sickness"; applyVitals drains hp
      p.vitals.radiationSicknessTimer = 9999; // persistent until treated
      sicknessArmed = true;
    }
  }
  return { gained, total: p.vitals.radiation, sicknessArmed };
};

/**
 * Treatment: Anti-Radiation Pills / food remove a fixed amount (GDD §15:
 * "Food, Water Bottles and Anti-Radiation Pills remove fixed amounts of
 * accumulated radiation"). Clears the sickness state if radiation drops
 * back under the threshold.
 */
export const reduceRadiation = (p: PlayerEntity, amount: number): number => {
  const before = p.vitals.radiation;
  p.vitals.radiation = Math.max(0, before - amount);
  if (p.vitals.radiation < RAD_SICKNESS_THRESHOLD && p.vitals.radiationSicknessTimer > 0) {
    p.vitals.radiationSicknessTimer = 0;
  }
  return before - p.vitals.radiation;
};

/**
 * System step: radiation for every live player. Runs after movement so the
 * tick's final position determines exposure.
 */
export const applyRadiation = (world: World, store: EntityStore): number => {
  let armed = 0;
  for (const e of store.values()) {
    if (e.kind !== "player" || e.dead) continue;
    const r = applyRadiationTick(world, e);
    if (r.sicknessArmed) armed += 1;
  }
  void TUNING; // dose rates are content-authored; nothing tuned here
  return armed;
};

/** Convenience for tests: rads accumulated over N ticks at a fixed spot. */
export const accumulateForTicks = (
  world: World,
  p: PlayerEntity,
  ticks: number,
): RadiationStepResult => {
  let last: RadiationStepResult = { gained: 0, total: p.vitals.radiation, sicknessArmed: false };
  for (let i = 0; i < ticks; i++) last = applyRadiationTick(world, p);
  return last;
};

export type { RadBand };
