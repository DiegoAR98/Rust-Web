import { z } from "zod";

/** GDD §24 identifier families, validated at content load. */
export const itemIdSchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]*$/, "item ids are snake_case category stems");
export const recipeIdSchema = z.string().regex(/^recipe_[a-z0-9_]+$/);
export const buildingIdSchema = z.string().regex(/^(build|deploy)_[a-z0-9_]+$/);
export const lootTableIdSchema = z.string().regex(/^(loot|stock|pocket)_[a-z0-9_]+$/);
export const creatureIdSchema = z.string().regex(/^(animal|crew|warden)_[a-z0-9_]+$/);
export const regionIdSchema = z.string().regex(/^region_[a-z0-9_]+$/);
export const blueprintIdSchema = z.string().regex(/^bp_[a-z0-9_]+$/);

export const itemCategorySchema = z.enum([
  "tool",
  "weapon",
  "attachment",
  "ammo",
  "armor",
  "medical",
  "food",
  "resource",
  "building",
  "deployable",
  "misc",
]);

export const stationSchema = z.enum(["hand", "campfire", "furnace", "workbench"]);

/** M3: which station (if any) an item's recipes run at — derived from RECIPES, not stored. */
export const researchableSchema = z.object({
  /** blueprint payload this item teaches when researched (GDD §9 Research) */
  blueprintPayload: blueprintIdSchema,
});

/** M3: station geometry (GDD §9: campfire = 3 cook + 1 fuel slot; furnace = 3 in / 3 out) */
export const stationCapacitySchema = z.object({
  /** input slots */
  slots: z.number().int().min(1).max(9),
  /** output slots */
  outputs: z.number().int().min(1).max(9),
  /** fuel slot count; 0 = not a fueled station */
  fuel: z.number().int().min(0).max(1),
});

export const toolSchema = z.object({
  /** calories cost per swing (GDD §6) */
  swingCalories: z.number().nonnegative(),
  /** harvest accumulator multiplier (GDD §7) */
  toolMultiplier: z.number().positive().max(4),
});

export const weaponSchema = z.object({
  kind: z.enum(["melee", "bow", "firearm", "explosive"]),
  baseDamage: z.number().nonnegative(),
  /** meters where falloff begins; 0 = no falloff */
  falloffStartM: z.number().nonnegative(),
  /** meters where falloff ends; damage floors at 25% at the end */
  falloffEndM: z.number().nonnegative(),
  /** seconds between shots; 0 for instant weapons */
  fireIntervalTicks: z.number().int().nonnegative(),
  magazineSize: z.number().int().nonnegative(),
  /** M6: the ammo item this weapon consumes per shot/bolt (bow=arrow, firearms=round). 0-magazine (melee/explosive) may omit. */
  ammoItemId: itemIdSchema.optional(),
  // ---- M6 (GDD §11): ranged + explosive mechanics ----
  /** firearm: ticks a full reload takes */
  reloadTicks: z.number().int().nonnegative().optional(),
  /** firearm: aim cone (degrees) — spread/bloom rolled on the combat RNG */
  spreadDegrees: z.number().nonnegative().optional(),
  /** bow: projectile speed in cm/s (gravity applies; recoverable on terrain) */
  projectileSpeedCmS: z.number().positive().optional(),
  /** firearm: pellet count for a shot (shotgun > 1; 1 for single-projectile) */
  pellets: z.number().int().min(1).max(8).optional(),
  /** explosive: fuse length in ticks before detonation */
  fuseTicks: z.number().int().positive().optional(),
  /** explosive: structure splash radius in meters (center piece takes full damage) */
  splashRadiusM: z.number().nonnegative().optional(),
  /** explosive: flat structure damage to the planted/target piece */
  structureDamage: z.number().nonnegative().optional(),
  /** explosive: flat character damage inside the splash radius */
  characterDamage: z.number().nonnegative().optional(),
});

export const armorSchema = z.object({
  slot: z.enum(["helmet", "vest", "pants", "boots"]),
  /** summed across worn pieces, clamped at 0.60 (GDD §11) */
  damageReduction: z.number().min(0).max(0.6),
  /** warmth contributed to cold deficit (GDD §6) */
  warmth: z.number().nonnegative(),
  /** fraction 0..1 of radiation blocked */
  radiationProtection: z.number().min(0).max(1),
});

export const foodSchema = z.object({
  /** calories restored */
  calories: z.number().nonnegative(),
  /** flat hp restored, 0 for none */
  healthRestore: z.number().nonnegative(),
  /** probability 0..1 of applying poison */
  poisonChance: z.number().min(0).max(1),
});

export const consumableSchema = z.object({
  kind: z.enum(["bandage", "medkit", "antirad"]),
  /** ticks the channel lasts */
  channelTicks: z.number().int().positive(),
  /** flat amount applied at completion (hp or rads) */
  amount: z.number().nonnegative(),
});

export const buildingSchema = z.object({
  tier: z.enum(["wood", "metal"]),
  maxHp: z.number().int().positive(),
  /** seconds of neglect before decay advances one step */
  decayDays: z.number().positive(),
  /** damage-immune pieces: foundation/pillar/ceiling */
  damageImmune: z.boolean(),
  /** M4 (GDD §10): how the piece can be breached.
   *  "melee" = breakable by tool swings (doors, shutters, barricades, shelter);
   *  "explosive_only" = immune to melee, M6 charges only (walls, stations);
   *  "immune" = foundations/pillars/ceilings (removed by decay only). */
  breach: z.enum(["melee", "explosive_only", "immune"]),
  /** M4: storage structure slot count (0 = not a storage piece) */
  storageSlots: z.number().int().min(0).max(24).default(0),
  /** M4: rest structure (sleeping bag) */
  restable: z.boolean().default(false),
});

export const itemSchema = z.object({
  id: itemIdSchema,
  category: itemCategorySchema,
  /** stack limit; weapons/tools are 1 */
  stackMax: z.number().int().min(1).max(255),
  /** ground pickup despawn in seconds; 0 = never */
  despawnSeconds: z.number().nonnegative().optional(),
  tool: toolSchema.optional(),
  weapon: weaponSchema.optional(),
  armor: armorSchema.optional(),
  food: foodSchema.optional(),
  consumable: consumableSchema.optional(),
  building: buildingSchema.optional(),
  /** M3: researchable at the Workbench (GDD §9); payload is the blueprint id */
  researchable: researchableSchema.optional(),
});
export type ItemDef = z.infer<typeof itemSchema>;

export const recipeSchema = z.object({
  id: recipeIdSchema,
  outputItemId: itemIdSchema,
  outputQuantity: z.number().int().min(1).max(1000),
  inputs: z.array(z.object({ itemId: itemIdSchema, quantity: z.number().int().min(1).max(1000) })).min(1),
  station: stationSchema,
  /** craft time in ticks */
  timeTicks: z.number().int().positive(),
  /** blueprint payload required; undefined = default recipe */
  requiresBlueprint: blueprintIdSchema.optional(),
});
export type RecipeDef = z.infer<typeof recipeSchema>;

export const radiationZoneSchema = z.object({
  id: z.string().regex(/^region_[a-z0-9_]+$/),
  /** meters from center */
  rimRadiusM: z.number().positive(),
  midRadiusM: z.number().positive(),
  coreRadiusM: z.number().positive(),
  band: z.enum(["low", "high", "extreme"]),
  center: z.object({ x: z.number(), y: z.number(), z: z.number() }),
});
export type RadiationZoneDef = z.infer<typeof radiationZoneSchema>;

/**
 * GDD §6: dose rates per band, rim/mid/core ring, in rads per REAL second
 * (the acceptance suite T03/T04 is specified in real seconds). Dose rates
 * are never summed across overlaps — the highest current ring wins.
 */
export const RAD_DOSE_RATES = {
  low: { rim: 0.5, mid: 1.0, core: 2.0 },
  high: { rim: 1.5, mid: 3.0, core: 5.0 },
  extreme: { rim: 12.0, mid: 24.0, core: 40.0 },
} as const;
export type RadBand = keyof typeof RAD_DOSE_RATES;
/** GDD §6: a full Rad Suit blocks 90% of the dose. */
export const RAD_SUIT_PROTECTION = 0.9;
/** GDD §6: at 500 rads, radiation sickness becomes lethal without treatment. */
export const RAD_SICKNESS_THRESHOLD = 500;

/**
 * M5: wildlife (GDD §12, Appendix E). The vertical slice seeds the three
 * prey plus the wolf; bear/boar/red variants join with the full AI in M7.
 * Dispositions: prey flees, hostile chases + attacks.
 */
export const animalKindSchema = z.enum(["rabbit", "chicken", "deer", "wolf", "boar", "bear", "red_wolf", "red_bear"]);
export type AnimalKind = z.infer<typeof animalKindSchema>;

export const animalSchema = z.object({
  kind: animalKindSchema,
  hp: z.number().int().positive(),
  /** cm/s ground speed */
  speedCmS: z.number().positive(),
  disposition: z.enum(["prey", "hostile"]),
  /** m: notice/flee (prey) or aggro (hostile) range */
  aggroRangeM: z.number().positive(),
  /** m: stop and idle / lose interest */
  calmRangeM: z.number().positive(),
  /** loot: item -> chance 0..1, rolled on the loot stream */
  loot: z.array(z.object({ itemId: z.string().min(1), chance: z.number().min(0).max(1) })).default([]),
});
export type AnimalDef = z.infer<typeof animalSchema>;

export const ANIMALS: readonly AnimalDef[] = [
  { kind: "rabbit", hp: 30, speedCmS: 180, disposition: "prey", aggroRangeM: 14, calmRangeM: 6, loot: [{ itemId: "raw_rabbit_meat", chance: 1 }, { itemId: "cloth", chance: 0.25 }] },
  { kind: "chicken", hp: 25, speedCmS: 150, disposition: "prey", aggroRangeM: 12, calmRangeM: 5, loot: [{ itemId: "raw_chicken_meat", chance: 1 }, { itemId: "cloth", chance: 0.15 }] },
  { kind: "deer", hp: 80, speedCmS: 240, disposition: "prey", aggroRangeM: 20, calmRangeM: 8, loot: [{ itemId: "raw_venison", chance: 1 }, { itemId: "leather", chance: 0.5 }, { itemId: "animal_fat", chance: 0.3 }] },
  { kind: "wolf", hp: 100, speedCmS: 280, disposition: "hostile", aggroRangeM: 18, calmRangeM: 30, loot: [{ itemId: "raw_wolf_meat", chance: 0.6 }, { itemId: "leather", chance: 0.4 }] },
];
export const ANIMAL_BY_KIND = new Map<AnimalKind, AnimalDef>(ANIMALS.map((a) => [a.kind, a]));

/** GDD §7: nodes have a resource pool, not hit points. */
export const nodeIdSchema = z.string().regex(/^node_[a-z0-9_]+$/);
export const nodeKindSchema = z.enum([
  "tree",
  "wood_pile",
  "stone_rock",
  "metal_ore",
  "sulfur_ore",
  "animal_corpse",
]);

export const nodeSchema = z.object({
  id: nodeIdSchema,
  kind: nodeKindSchema,
  /** primary resource paid out per whole harvest unit */
  resourceItemId: itemIdSchema,
  /** resource units until the node is depleted */
  pool: z.number().int().positive().max(99),
  /** authored respawn timer in game seconds; 0 = does not respawn */
  respawnSeconds: z.number().int().nonnegative(),
  /** swings with a tool multiplier below this contribute nothing (GDD §7 tool preference) */
  minToolMultiplier: z.number().positive().max(4),
  /** extra rolls per paid unit (GDD §7: animal corpse yields cloth/fat/occasional blood) */
  secondaries: z
    .array(z.object({ itemId: itemIdSchema, probability: z.number().min(0).max(1) }))
    .optional(),
});
export type NodeDef = z.infer<typeof nodeSchema>;

/** Seeded per-region node placement (world generation input). */
export const nodePlacementSchema = z.object({
  nodeId: nodeIdSchema,
  regionId: regionIdSchema,
  count: z.number().int().positive().max(500),
  /** scatter radius around the anchor, meters */
  scatterM: z.number().positive().max(500),
  /** anchor at the first spawn point instead of the first tile center */
  nearSpawn: z.boolean().optional(),
});
export type NodePlacementDef = z.infer<typeof nodePlacementSchema>;

export const tuningSchema = z.record(
  z.string().regex(/^[a-z][a-z0-9_.]*$/),
  z.union([z.number().finite(), z.string(), z.boolean()]),
);
export type TuningDef = z.infer<typeof tuningSchema>;
