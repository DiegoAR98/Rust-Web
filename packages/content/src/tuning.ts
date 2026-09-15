/**
 * Appendix F tuning constants. Every key has a single data owner: this file.
 * No gameplay tuning value may exist only as a code literal (GDD §24).
 */
import type { TuningDef } from "./schemas.js";

export const TUNING: TuningDef = {
  "time.tick_hz": 30,
  "time.day_seconds": 3600,
  "time.daylight_seconds": 2700,
  "time.night_seconds": 900,
  "survival.max_health": 100,
  "survival.max_calories": 3000,
  "survival.max_radiation": 500,
  "survival.bleed_damage_per_second": 2.0,
  "survival.idle_drain_per_second": 0.35,
  "survival.move_drain_per_second": 0.55,
  "survival.sprint_drain_per_second": 0.8,
  "survival.starved_hp_drain_per_second": 0.25,
  "survival.bleed_hp_per_second": 2.0,
  "survival.cold_hp_per_second": 0.5,
  "survival.heal_rate_per_second": 0.15,
  "survival.comfort_heal_rate_per_second": 0.5,
  "move.walk_speed": 3.5,
  "move.sprint_speed": 5.5,
  "move.crouch_speed": 1.8,
  "move.jump_impulse": 5.0,
  "move.gravity": 19.6,
  "move.max_step_height": 0.3,
  "move.blocking_lip": 0.4,
  "move.swim_speed": 2.2,
  "move.fall_damage_threshold_m": 3.0,
  "move.fall_damage_hp_per_meter": 10,
  "move.melee_reach": 1.5,
  "camera.default_fov": 80,
  "build.grid_size": 4,
  "build.max_height_levels": 6,
  "loot.ground_pickup_radius": 1.5,
  "loot.max_ground_stacks": 400,
  "loot.pickup_reach_m": 2.0,
  "gather.swing_reach_m": 3.0,
  "gather.swing_cooldown_ticks": 24,
  "gather.respawn_safety_window_seconds": 1440,
  // M3: crafting & structure placement
  "craft.reach_m": 3.0, // max distance to a placed station to use it
  "build.place_reach_m": 5.0, // max distance to place a structure from the player
  "build.min_spacing_m": 2.0, // min center-to-center distance between structures
  "build.max_structures_per_player": 32,
  // M4: decay — unattended structures lose integrity on this timer; owner
  // within 50 m refreshes the timer (GDD §10: "Decay refreshes when the
  // owner is within 50 m").
  "decay.owner_refresh_m": 50, // owner proximity that suspends decay
  "decay.step_fraction": 0.1, // integrity lost per decay step (of maxHp)
  "ai.max_humans": 14,
  "ai.max_animals": 8,
  "ai.evidence_memory_seconds": 30,
  "ai.active_players_default": 14,
  "raid.max_loot_seconds": 480,
  "raid.stage_line_distance": 80,
  "raid.approach_distance": 1.5,
  // M5: radiation — dose rates are authored in content/schemas.ts
  // (RAD_DOSE_RATES); these shape sickness + treatment.
  "radiation.sickness_hp_drain_per_second": 0.5, // escalating loss while sick
  "radiation.sickness_threshold": 500, // rads at which sickness becomes lethal
  "radiation.pill_remove": 200, // Anti-Radiation Pills flat-removal (GDD §6)
  // M5: cold (GDD §6) — coldPressure = regionBase + altitude + night + weather
  "cold.region_base_pressure": 0, // flat baseline cold pressure (per-tick pressure unit)
  "cold.night_pressure": 4, // added at night
  "cold.weather_rain_pressure": 4, // rain chills
  "cold.weather_fog_pressure": 2,
  "cold.campfire_comfort_radius_m": 6, // within a campfire with zero deficit -> comfort
  "cold.campfire_warmth": 30, // warmth granted by proximity to a campfire
  // M5: weather (GDD §16) — seeded state changes with a min clear interval
  "weather.change_min_clear_ticks": 5400, // 3 game-min: min time between weather events
  "weather.duration_min_ticks": 3600, // 2 game-min: min a state persists
  "weather.duration_max_ticks": 14400, // 8 game-min: max a state persists
  // M5: wildlife (GDD §12) — spawn/despawn distances and active cap
  "animal.spawn_min_players_m": 20, // never spawn within this of a player
  "animal.spawn_max_players_m": 60, // prefer to spawn within this of a player
  "animal.active_cap": 8, // no more than eight animals active at once
  "animal.despawn_idle_seconds": 420, // 7 real-min: despawn when far + untargeted
};
