/**
 * M5: weather + cold (GDD §6 "Cold", §16 "Time, weather and environment").
 *
 * Weather is a seeded, bounded state machine: Clear, Overcast, Rain, Fog,
 * Dry Wind. Events have a minimum clear interval between changes and a
 * min/max duration so the world stays readable. Weather chills (rain, fog)
 * and is fed into the per-tick cold pressure.
 *
 * Cold (GDD §6): each tick computes
 *   coldPressure = regionBase + altitude + night + weather
 *   warmth       = worn armor warmth + campfire proximity
 *   coldDeficit  = max(0, coldPressure - warmth)
 * Bands: 1–24 extra calorie drain; 25–59 healing stops; 60+ hp drain +
 * bleeding risk. A campfire within 6 m with zero deficit grants Comfort.
 */
import { TUNING } from "@dustfall/content";
import type { EntityStore, PlayerEntity, StructureEntity } from "./entities.js";
import type { World, WeatherState } from "./world.js";
import { isNight } from "./world.js";
import { SUBSYSTEM } from "./rng.js";
import { ITEMS } from "@dustfall/content";

/** Armor warmth lookup (content-owned), cached. */
const armorWarmthCache = new Map<string, number>();
const armorWarmth = (itemId: string): number => {
  if (!armorWarmthCache.has(itemId)) {
    armorWarmthCache.set(itemId, ITEMS.find((i) => i.id === itemId)?.armor?.warmth ?? 0);
  }
  return armorWarmthCache.get(itemId)!;
};

const WEATHER_STATES: WeatherState[] = ["clear", "overcast", "rain", "fog", "dry_wind"];

/**
 * System step: advance the weather state machine once per tick. Pure w.r.t.
 * the world's RNG (the weather stream), so a fixed seed reproduces the
 * exact weather sequence (GDD §21.5: deterministic, no Math.random).
 */
export const applyWeather = (world: World): WeatherState => {
  const rng = world.rng.get(SUBSYSTEM.weather);
  if (!rng) return world.weather;

  if (world.clock.tick >= world.weatherNextChangeAtTick) {
    // pick a new state, not the one we're leaving
    let next = WEATHER_STATES[rng.nextInt(WEATHER_STATES.length)];
    if (next === world.weather) next = WEATHER_STATES[rng.nextInt(WEATHER_STATES.length)];
    world.weather = next;
    const minDur = TUNING["weather.duration_min_ticks"] as number;
    const maxDur = TUNING["weather.duration_max_ticks"] as number;
    world.weatherNextChangeAtTick = world.clock.tick + minDur + Math.floor(rng.nextFloat() * (maxDur - minDur));
  }
  return world.weather;
};

/** Weather chill contribution to cold pressure (GDD §16: weather changes temperature). */
const weatherChill = (state: WeatherState): number => {
  switch (state) {
    case "rain":
      return TUNING["cold.weather_rain_pressure"] as number;
    case "fog":
      return TUNING["cold.weather_fog_pressure"] as number;
    case "overcast":
      return 1;
    default:
      return 0;
  }
};

const warmthOf = (p: PlayerEntity): number => {
  let w = 0;
  for (const eq of Object.values(p.equipment)) {
    if (!eq) continue;
    w += armorWarmth(eq.itemId);
  }
  return w;
};

/**
 * System step: compute cold deficit + campfire comfort for every live
 * player. Runs after movement + radiation so the tick's final position is
 * used.
 */
export const applyCold = (world: World, store: EntityStore): void => {
  const night = isNight(world.clock);
  const nightP = TUNING["cold.night_pressure"] as number;
  const baseP = TUNING["cold.region_base_pressure"] as number;
  const chill = weatherChill(world.weather);
  const campRadius = (TUNING["cold.campfire_comfort_radius_m"] as number) * 100;
  const campWarmth = TUNING["cold.campfire_warmth"] as number;

  // gather campfire positions once
  const campfires: { x: number; z: number }[] = [];
  for (const e of store.values()) {
    if (e.kind === "structure" && (e as StructureEntity).contentId === "campfire") {
      campfires.push({ x: (e as StructureEntity).position.x, z: (e as StructureEntity).position.z });
    }
  }

  for (const e of store.values()) {
    if (e.kind !== "player" || e.dead) continue;
    const p = e as PlayerEntity;

    // altitude: y in cm; the basin is roughly flat, so a small factor
    const altitudeP = Math.max(0, p.position.y / 100) * 0.5;

    const pressure = baseP + altitudeP + (night ? nightP : 0) + chill;
    const warmth = warmthOf(p) + nearestCampfireWarmth(p, campfires, campRadius, campWarmth);
    p.vitals.coldDeficit = Math.max(0, Math.round(pressure - warmth));

    // Comfort: within campfire radius AND no deficit -> raised regen
    const nearCamp = campfires.some((c) => {
      const dx = p.position.x - c.x;
      const dz = p.position.z - c.z;
      return dx * dx + dz * dz <= campRadius * campRadius;
    });
    if (nearCamp && p.vitals.coldDeficit === 0) {
      p.vitals.comfortTimer = Math.max(p.vitals.comfortTimer, 2); // keep it warm
    }

    // GDD §6: deficit 1–24 drains extra calories
    if (p.vitals.coldDeficit > 0 && p.vitals.coldDeficit <= 24) {
      p.vitals.calories = Math.max(0, p.vitals.calories - 0.1);
    }
  }
};

const nearestCampfireWarmth = (
  p: PlayerEntity,
  campfires: { x: number; z: number }[],
  radius: number,
  warmth: number,
): number => {
  for (const c of campfires) {
    const dx = p.position.x - c.x;
    const dz = p.position.z - c.z;
    if (dx * dx + dz * dz <= radius * radius) return warmth;
  }
  return 0;
};
