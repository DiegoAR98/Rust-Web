/**
 * Identifier families per GDD §24.
 * Branded types keep id families from being mixed accidentally.
 */

export type ItemId = string & { readonly __brand?: "ItemId" };
export type RecipeId = string & { readonly __brand?: "RecipeId" };
export type BuildingId = string & { readonly __brand?: "BuildingId" };
export type LootTableId = string & { readonly __brand?: "LootTableId" };
export type CreatureId = string & { readonly __brand?: "CreatureId" };
export type RegionId = string & { readonly __brand?: "RegionId" };
export type BlueprintId = string & { readonly __brand?: "BlueprintId" };
export type EntityId = string & { readonly __brand?: "EntityId" };
export type PlayerId = string & { readonly __brand?: "PlayerId" };

export const ITEM_ID = {
  parse: (s: string): ItemId => s as ItemId,
} as const;
export const RECIPE_ID = {
  parse: (s: string): RecipeId => s as RecipeId,
} as const;
export const BUILDING_ID = {
  parse: (s: string): BuildingId => s as BuildingId,
} as const;
export const LOOT_TABLE_ID = {
  parse: (s: string): LootTableId => s as LootTableId,
} as const;
export const CREATURE_ID = {
  parse: (s: string): CreatureId => s as CreatureId,
} as const;
export const REGION_ID = {
  parse: (s: string): RegionId => s as RegionId,
} as const;
export const BLUEPRINT_ID = {
  parse: (s: string): BlueprintId => s as BlueprintId,
} as const;
export const ENTITY_ID = {
  parse: (s: string): EntityId => s as EntityId,
} as const;
export const PLAYER_ID = {
  parse: (s: string): PlayerId => s as PlayerId,
} as const;
