/**
 * World root: owns clock, weather, and RNG state.
 * Engine-free per GDD §21.4; no Node/DOM/timers.
 *
 * Clock rate (ADR-0004): 30 ticks = 1 real second; 108,000 ticks = 1 game day
 * (86,400 game seconds). Game time runs at 24× real time.
 */
import { TICK_HZ } from "@dustfall/content";
import type { SubsystemId } from "./rng.js";
import { Rng, SUBSYSTEM } from "./rng.js";

export const TICK_RATE = TICK_HZ; // 30 Hz (real time)
/** Real seconds per tick: movement and survival rates use this. */
export const REAL_SECONDS_PER_TICK = 1 / TICK_RATE;
/** Game (in-world) seconds per tick: 86,400 game s / 108,000 ticks. */
export const GAME_SECONDS_PER_TICK = 4 / 5;
export const DAY_TICKS = 108_000; // 3,600 real seconds = one game day
export const GAME_SECONDS_PER_DAY = 86_400;
export const NIGHT_TICKS = 54_000; // 05:00:00 .. 23:00:00 game time
export const DAYLIGHT_TICKS = DAY_TICKS - NIGHT_TICKS;

export type WeatherState = "clear" | "overcast" | "rain" | "fog" | "dry_wind";

export interface WorldClock {
  /** absolute simulation tick, monotonically increasing */
  tick: number;
  /** game time-of-day in whole game seconds [0, 86400) */
  gameSecondsOfDay: number;
  /** total game days elapsed */
  day: number;
}

export interface World {
  worldId: string;
  seedA: number;
  seedB: number;
  clock: WorldClock;
  weather: WeatherState;
  rng: Map<SubsystemId, Rng>;
}

export const createWorld = (worldId: string, seedA: number, seedB: number): World => ({
  worldId,
  seedA: seedA >>> 0,
  seedB: seedB >>> 0,
  clock: { tick: 0, gameSecondsOfDay: 0, day: 0 },
  weather: "clear",
  rng: new Map<SubsystemId, Rng>([
    [SUBSYSTEM.world, Rng.derive(seedA, seedB, SUBSYSTEM.world)],
    [SUBSYSTEM.loot, Rng.derive(seedA, seedB, SUBSYSTEM.loot)],
    [SUBSYSTEM.nodeRespawn, Rng.derive(seedA, seedB, SUBSYSTEM.nodeRespawn)],
    [SUBSYSTEM.ai, Rng.derive(seedA, seedB, SUBSYSTEM.ai)],
    [SUBSYSTEM.weather, Rng.derive(seedA, seedB, SUBSYSTEM.weather)],
    [SUBSYSTEM.airdrop, Rng.derive(seedA, seedB, SUBSYSTEM.airdrop)],
  ]),
});

/** True if game time-of-day is in the night window 23:00:00 .. 05:00:00 (GDD §16). */
export const isNight = (clock: WorldClock): boolean => {
  const s = clock.gameSecondsOfDay;
  return s >= 23 * 3600 || s < 5 * 3600;
};

/**
 * Advance the world clock by exactly one tick.
 * Integer math keeps day/night boundaries exact (T01/T02, ADR-0004):
 * game time-of-day = floor(4 * (tick % DAY_TICKS) / 5).
 */
export const advanceClock = (world: World): void => {
  world.clock.tick += 1;
  const r = world.clock.tick % DAY_TICKS;
  world.clock.day = Math.floor(world.clock.tick / DAY_TICKS);
  world.clock.gameSecondsOfDay = Math.floor((4 * r) / 5);
};
