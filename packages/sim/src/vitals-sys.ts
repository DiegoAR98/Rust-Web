/**
 * Survival vitals system (GDD §6).
 */
import { REAL_SECONDS_PER_TICK as SECONDS_PER_TICK } from "./world.js";
import { TUNING } from "@dustfall/content";
import type { PlayerEntity } from "./entities.js";

export const applyVitals = (p: PlayerEntity, moving: boolean, sprinting: boolean): void => {
  const idle = TUNING["survival.idle_drain_per_second"] as number;
  const moveDrain = TUNING["survival.move_drain_per_second"] as number;
  const sprintDrain = TUNING["survival.sprint_drain_per_second"] as number;
  const starved = TUNING["survival.starved_hp_drain_per_second"] as number;
  const bleed = TUNING["survival.bleed_hp_per_second"] as number;
  const coldHp = TUNING["survival.cold_hp_per_second"] as number;
  const healRate = TUNING["survival.heal_rate_per_second"] as number;
  const comfortHeal = TUNING["survival.comfort_heal_rate_per_second"] as number;

  let drain: number;
  if (sprinting) drain = sprintDrain;
  else if (moving) drain = moveDrain;
  else drain = idle;
  p.vitals.calories = Math.max(0, p.vitals.calories - drain * SECONDS_PER_TICK);

  if (p.vitals.calories <= 0) {
    p.vitals.health -= starved * SECONDS_PER_TICK;
  }

  if (p.vitals.bleeding > 0) {
    p.vitals.health -= bleed * SECONDS_PER_TICK;
    p.vitals.bleeding = Math.max(0, p.vitals.bleeding - 1 * SECONDS_PER_TICK);
  }

  if (p.vitals.coldDeficit >= 60) {
    p.vitals.health -= coldHp * SECONDS_PER_TICK;
  }

  // passive heal
  const rate = p.vitals.comfortTimer > 0 ? comfortHeal : healRate;
  if (p.vitals.coldDeficit < 25 && p.vitals.bleeding === 0 && p.vitals.calories > 0) {
    p.vitals.health = Math.min(100, p.vitals.health + rate * SECONDS_PER_TICK);
  }

  // timers
  if (p.vitals.poisonedTimer > 0) p.vitals.poisonedTimer = Math.max(0, p.vitals.poisonedTimer - SECONDS_PER_TICK);
  if (p.vitals.radiationSicknessTimer > 0) {
    p.vitals.radiationSicknessTimer = Math.max(0, p.vitals.radiationSicknessTimer - SECONDS_PER_TICK);
    p.vitals.health -= 0.5 * SECONDS_PER_TICK;
  }
  if (p.vitals.comfortTimer > 0) p.vitals.comfortTimer = Math.max(0, p.vitals.comfortTimer - SECONDS_PER_TICK);

  // death
  if (p.vitals.health <= 0 && !p.dead) {
    p.vitals.health = 0;
    p.dead = true;
    p.deadTicks = 0;
  }
};
