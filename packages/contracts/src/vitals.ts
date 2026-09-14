/**
 * Player vitals per GDD §6. Ranges are contract-level;
 * the simulation enforces them every tick.
 */
export interface Vitals {
  /** 0..100; zero causes immediate death */
  health: number;
  /** 0..3000 calories */
  calories: number;
  /** 0..500 radiation */
  radiation: number;
  /** 0..100 bleeding */
  bleeding: number;
  /** 0..100 cold deficit */
  coldDeficit: number;
  /** seconds remaining, 0 = clear */
  poisonedTimer: number;
  /** seconds remaining, 0 = clear */
  radiationSicknessTimer: number;
  /** seconds remaining, 0 = clear */
  comfortTimer: number;
}

export const VITAL_LIMITS = {
  maxHealth: 100,
  maxCalories: 3000,
  maxRadiation: 500,
  maxBleeding: 100,
  maxColdDeficit: 100,
} as const;

export const freshVitals = (): Vitals => ({
  health: VITAL_LIMITS.maxHealth,
  calories: 1500,
  radiation: 0,
  bleeding: 0,
  coldDeficit: 0,
  poisonedTimer: 0,
  radiationSicknessTimer: 0,
  comfortTimer: 0,
});
