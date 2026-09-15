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
