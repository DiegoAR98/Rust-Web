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

export const tuningSchema = z.record(
  z.string().regex(/^[a-z][a-z0-9_.]*$/),
  z.union([z.number().finite(), z.string(), z.boolean()]),
);
export type TuningDef = z.infer<typeof tuningSchema>;
