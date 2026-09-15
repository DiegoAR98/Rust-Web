/**
 * Launch item catalog spine (GDD Appendices A + B).
 * M0 seeds the first-session arc items; the full catalog lands as each
 * milestone needs it. Every row is validated by validate.ts.
 */
import type { ItemDef } from "./schemas.js";

export const ITEMS: readonly ItemDef[] = [
  // ---- tools ----
  { id: "rock", category: "tool", stackMax: 1, tool: { swingCalories: 5, toolMultiplier: 0.5 } },
  { id: "stone_hatchet", category: "tool", stackMax: 1, tool: { swingCalories: 10, toolMultiplier: 1 } },
  { id: "hatchet", category: "tool", stackMax: 1, tool: { swingCalories: 10, toolMultiplier: 2 } },
  { id: "pickaxe", category: "tool", stackMax: 1, tool: { swingCalories: 12, toolMultiplier: 2 } },
  { id: "torch", category: "tool", stackMax: 1, tool: { swingCalories: 0, toolMultiplier: 0.5 } },
  // ---- ammo (starter tier) ----
  { id: "arrow", category: "ammo", stackMax: 100 },
  // ---- weapons (starter tier; full ladder in M6) ----
  {
    id: "hunting_bow",
    category: "weapon",
    stackMax: 1,
    weapon: { kind: "bow", baseDamage: 12, falloffStartM: 10, falloffEndM: 40, fireIntervalTicks: 30, magazineSize: 0 },
  },
  {
    id: "pipe_shotgun",
    category: "weapon",
    stackMax: 1,
    weapon: { kind: "firearm", baseDamage: 14, falloffStartM: 8, falloffEndM: 30, fireIntervalTicks: 30, magazineSize: 6 },
  },
  // ---- resources ----
  { id: "wood", category: "resource", stackMax: 100, despawnSeconds: 600 },
  { id: "stone", category: "resource", stackMax: 100, despawnSeconds: 600 },
  { id: "metal_ore", category: "resource", stackMax: 100, despawnSeconds: 600 },
  { id: "sulfur_ore", category: "resource", stackMax: 100, despawnSeconds: 600 },
  { id: "metal_fragments", category: "resource", stackMax: 100, despawnSeconds: 600 },
  { id: "sulfur", category: "resource", stackMax: 100, despawnSeconds: 600 },
  { id: "charcoal", category: "resource", stackMax: 100, despawnSeconds: 600 },
  { id: "cloth", category: "resource", stackMax: 100, despawnSeconds: 600 },
  { id: "leather", category: "resource", stackMax: 100, despawnSeconds: 600 },
  { id: "animal_fat", category: "resource", stackMax: 100, despawnSeconds: 600 },
  { id: "blood", category: "resource", stackMax: 100, despawnSeconds: 300 },
  { id: "gunpowder", category: "resource", stackMax: 100, despawnSeconds: 600 },
  { id: "low_grade_fuel", category: "resource", stackMax: 100, despawnSeconds: 600 },
  // ---- food ----
  { id: "raw_rabbit_meat", category: "food", stackMax: 100, despawnSeconds: 300, food: { calories: 100, healthRestore: 0, poisonChance: 0.3 } },
  { id: "cooked_rabbit_meat", category: "food", stackMax: 100, food: { calories: 100, healthRestore: 0, poisonChance: 0 } },
  { id: "raw_chicken_meat", category: "food", stackMax: 100, despawnSeconds: 300, food: { calories: 80, healthRestore: 0, poisonChance: 0.3 } },
  { id: "cooked_chicken_meat", category: "food", stackMax: 100, food: { calories: 80, healthRestore: 0, poisonChance: 0 } },
  { id: "chocolate_bar", category: "food", stackMax: 50, food: { calories: 300, healthRestore: 0, poisonChance: 0 } },
  { id: "water_bottle", category: "food", stackMax: 10, food: { calories: 0, healthRestore: 0, poisonChance: 0 } },
  // ---- medical ----
  { id: "bandage", category: "medical", stackMax: 10, consumable: { kind: "bandage", channelTicks: 300, amount: 5 } },
  { id: "small_medkit", category: "medical", stackMax: 1, consumable: { kind: "medkit", channelTicks: 240, amount: 40 } },
  { id: "large_medkit", category: "medical", stackMax: 1, consumable: { kind: "medkit", channelTicks: 600, amount: 100 } },
  { id: "anti_radiation_pills", category: "medical", stackMax: 10, consumable: { kind: "antirad", channelTicks: 30, amount: 200 } },
  // ---- starter armor (cloth tier) ----
  { id: "cloth_helmet", category: "armor", stackMax: 1, armor: { slot: "helmet", damageReduction: 0.05, warmth: 2, radiationProtection: 0 } },
  { id: "cloth_vest", category: "armor", stackMax: 1, armor: { slot: "vest", damageReduction: 0.1, warmth: 4, radiationProtection: 0 } },
  { id: "cloth_pants", category: "armor", stackMax: 1, armor: { slot: "pants", damageReduction: 0.05, warmth: 4, radiationProtection: 0 } },
  { id: "cloth_boots", category: "armor", stackMax: 1, armor: { slot: "boots", damageReduction: 0.05, warmth: 3, radiationProtection: 0 } },
  // ---- research ----
  { id: "research_kit", category: "misc", stackMax: 5 },
  // ---- building & deployables (M4 adds full grid rules) ----
  { id: "wood_shelter", category: "building", stackMax: 1, building: { tier: "wood", maxHp: 500, decayDays: 3, damageImmune: false } },
  { id: "campfire", category: "deployable", stackMax: 1, building: { tier: "wood", maxHp: 250, decayDays: 3, damageImmune: false } },
  { id: "furnace", category: "deployable", stackMax: 1, building: { tier: "wood", maxHp: 1000, decayDays: 7, damageImmune: false } },
  { id: "workbench", category: "deployable", stackMax: 1, building: { tier: "wood", maxHp: 500, decayDays: 7, damageImmune: false } },
  { id: "wood_storage_box", category: "deployable", stackMax: 1, building: { tier: "wood", maxHp: 500, decayDays: 7, damageImmune: false } },
  { id: "sleeping_bag", category: "deployable", stackMax: 1, building: { tier: "wood", maxHp: 250, decayDays: 3, damageImmune: false } },
];
