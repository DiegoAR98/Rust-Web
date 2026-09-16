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
  { id: "hatchet", category: "tool", stackMax: 1, tool: { swingCalories: 10, toolMultiplier: 2 }, researchable: { blueprintPayload: "bp_pickaxe" } },
  { id: "pickaxe", category: "tool", stackMax: 1, tool: { swingCalories: 12, toolMultiplier: 2 } },
  { id: "torch", category: "tool", stackMax: 1, tool: { swingCalories: 0, toolMultiplier: 0.5 } },
  // ---- ammo (M6: full ladder, GDD Appendix A) ----
  { id: "arrow", category: "ammo", stackMax: 100 },
  { id: "handmade_shell", category: "ammo", stackMax: 100 },
  { id: "nine_mm_round", category: "ammo", stackMax: 100 },
  { id: "rifle_round", category: "ammo", stackMax: 100 },
  { id: "shotgun_shell", category: "ammo", stackMax: 100 },
  // ---- weapons (M6: full ladder, GDD §11 + Appendix A). Base values are
  // authored here (the GDD specifies the damage formula + falloff shape, not
  // per-weapon numbers); every field is validated by the schema. ----
  {
    id: "hunting_bow",
    category: "weapon",
    stackMax: 1,
    weapon: {
      kind: "bow",
      baseDamage: 12,
      falloffStartM: 10,
      falloffEndM: 40,
      fireIntervalTicks: 30,
      magazineSize: 0,
      ammoItemId: "arrow",
      projectileSpeedCmS: 600,
    },
  },
  {
    id: "hand_cannon",
    category: "weapon",
    stackMax: 1,
    weapon: {
      kind: "firearm",
      baseDamage: 30,
      falloffStartM: 5,
      falloffEndM: 15,
      fireIntervalTicks: 90,
      magazineSize: 1,
      ammoItemId: "handmade_shell",
      pellets: 1,
      spreadDegrees: 1.5,
      reloadTicks: 300,
    },
  },
  {
    id: "pipe_shotgun",
    category: "weapon",
    stackMax: 1,
    weapon: {
      kind: "firearm",
      baseDamage: 14,
      falloffStartM: 8,
      falloffEndM: 30,
      fireIntervalTicks: 30,
      magazineSize: 6,
      ammoItemId: "shotgun_shell",
      pellets: 6,
      spreadDegrees: 8,
      reloadTicks: 150,
    },
  },
  {
    id: "nine_mm_pistol",
    category: "weapon",
    stackMax: 1,
    weapon: {
      kind: "firearm",
      baseDamage: 18,
      falloffStartM: 6,
      falloffEndM: 25,
      fireIntervalTicks: 30,
      magazineSize: 8,
      ammoItemId: "nine_mm_round",
      pellets: 1,
      spreadDegrees: 2.5,
      reloadTicks: 150,
    },
  },
  {
    id: "assault_rifle",
    category: "weapon",
    stackMax: 1,
    researchable: { blueprintPayload: "bp_assault_rifle" },
    weapon: {
      kind: "firearm",
      baseDamage: 26,
      falloffStartM: 15,
      falloffEndM: 60,
      fireIntervalTicks: 18,
      magazineSize: 30,
      ammoItemId: "nine_mm_round",
      pellets: 1,
      spreadDegrees: 2,
      reloadTicks: 240,
    },
  },
  {
    id: "bolt_action_rifle",
    category: "weapon",
    stackMax: 1,
    researchable: { blueprintPayload: "bp_bolt_action_rifle" },
    weapon: {
      kind: "firearm",
      baseDamage: 55,
      falloffStartM: 15,
      falloffEndM: 80,
      fireIntervalTicks: 90,
      magazineSize: 5,
      ammoItemId: "rifle_round",
      pellets: 1,
      spreadDegrees: 0.5,
      reloadTicks: 180,
    },
  },
  // ---- explosives (M6, GDD §11). Category "weapon", kind "explosive". ----
  {
    id: "hand_grenade",
    category: "weapon",
    stackMax: 1,
    weapon: {
      kind: "explosive",
      baseDamage: 0,
      falloffStartM: 0,
      falloffEndM: 0,
      fireIntervalTicks: 30,
      magazineSize: 0,
      fuseTicks: 120, // 4 s
      structureDamage: 85,
      splashRadiusM: 3,
      characterDamage: 50,
    },
  },
  {
    id: "explosive_charge",
    category: "weapon",
    stackMax: 1,
    researchable: { blueprintPayload: "bp_explosive_charge" },
    weapon: {
      kind: "explosive",
      baseDamage: 0,
      falloffStartM: 0,
      falloffEndM: 0,
      fireIntervalTicks: 30,
      magazineSize: 0,
      fuseTicks: 300, // 10 s
      structureDamage: 600,
      splashRadiusM: 4,
      characterDamage: 80,
    },
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
  { id: "explosives", category: "resource", stackMax: 100, despawnSeconds: 600 },
  // ---- food ----
  { id: "raw_rabbit_meat", category: "food", stackMax: 100, despawnSeconds: 300, food: { calories: 100, healthRestore: 0, poisonChance: 0.3 } },
  { id: "cooked_rabbit_meat", category: "food", stackMax: 100, food: { calories: 100, healthRestore: 0, poisonChance: 0 } },
  { id: "raw_chicken_meat", category: "food", stackMax: 100, despawnSeconds: 300, food: { calories: 80, healthRestore: 0, poisonChance: 0.3 } },
  { id: "cooked_chicken_meat", category: "food", stackMax: 100, food: { calories: 80, healthRestore: 0, poisonChance: 0 } },
  { id: "raw_venison", category: "food", stackMax: 100, despawnSeconds: 300, food: { calories: 200, healthRestore: 0, poisonChance: 0.3 } },
  { id: "cooked_venison", category: "food", stackMax: 100, food: { calories: 200, healthRestore: 0, poisonChance: 0 } },
  { id: "raw_wolf_meat", category: "food", stackMax: 100, despawnSeconds: 300, food: { calories: 150, healthRestore: 0, poisonChance: 0.3 } },
  { id: "cooked_wolf_meat", category: "food", stackMax: 100, food: { calories: 150, healthRestore: 0, poisonChance: 0 } },
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
  // M5: Rad Suit — full-body protection, blocks 90% of the dose (GDD §6 T04).
  // High-tier loot item; obtained from containers/airdrops, not crafted.
  { id: "rad_suit", category: "armor", stackMax: 1, armor: { slot: "vest", damageReduction: 0.1, warmth: 4, radiationProtection: 0.9 } },
  // ---- M6 armor: leather tier (crafted) + ballistic tier (researchable/loot).
  // Armor reductions SUM across worn pieces and clamp at 0.60 (GDD §11); the
  // per-piece values below keep a full cloth set (~0.25) under that cap. ----
  { id: "leather_helmet", category: "armor", stackMax: 1, armor: { slot: "helmet", damageReduction: 0.1, warmth: 4, radiationProtection: 0 } },
  { id: "leather_vest", category: "armor", stackMax: 1, armor: { slot: "vest", damageReduction: 0.2, warmth: 6, radiationProtection: 0 } },
  { id: "leather_pants", category: "armor", stackMax: 1, armor: { slot: "pants", damageReduction: 0.1, warmth: 4, radiationProtection: 0 } },
  { id: "leather_boots", category: "armor", stackMax: 1, armor: { slot: "boots", damageReduction: 0.05, warmth: 3, radiationProtection: 0 } },
  { id: "ballistic_helmet", category: "armor", stackMax: 1, researchable: { blueprintPayload: "bp_ballistic_helmet" }, armor: { slot: "helmet", damageReduction: 0.15, warmth: 3, radiationProtection: 0 } },
  { id: "ballistic_vest", category: "armor", stackMax: 1, researchable: { blueprintPayload: "bp_ballistic_vest" }, armor: { slot: "vest", damageReduction: 0.25, warmth: 4, radiationProtection: 0 } },
  { id: "ballistic_pants", category: "armor", stackMax: 1, researchable: { blueprintPayload: "bp_ballistic_pants" }, armor: { slot: "pants", damageReduction: 0.1, warmth: 3, radiationProtection: 0 } },
  { id: "ballistic_boots", category: "armor", stackMax: 1, researchable: { blueprintPayload: "bp_ballistic_boots" }, armor: { slot: "boots", damageReduction: 0.05, warmth: 3, radiationProtection: 0 } },
  // ---- research ----
  { id: "research_kit", category: "misc", stackMax: 5 },
  // ---- building & deployables (M4: full grid rules) ----
  { id: "wood_shelter", category: "building", stackMax: 1, building: { tier: "wood", maxHp: 500, decayDays: 3, damageImmune: false, breach: "melee", storageSlots: 0, restable: false } },
  { id: "wood_wall", category: "building", stackMax: 1, building: { tier: "wood", maxHp: 800, decayDays: 10, damageImmune: false, breach: "melee", storageSlots: 0, restable: false } },
  { id: "wood_door", category: "building", stackMax: 1, building: { tier: "wood", maxHp: 500, decayDays: 3, damageImmune: false, breach: "melee", storageSlots: 0, restable: false } },
  { id: "wood_barricade", category: "building", stackMax: 1, building: { tier: "wood", maxHp: 400, decayDays: 3, damageImmune: false, breach: "melee", storageSlots: 0, restable: false } },
  // M6 (GDD Appendix C): metal tier — charge-only breach, 14-day decay.
  // Metal is an in-place upgrade path, not a separate structure socket.
  { id: "metal_door", category: "building", stackMax: 1, building: { tier: "metal", maxHp: 1000, decayDays: 14, damageImmune: false, breach: "explosive_only", storageSlots: 0, restable: false } },
  { id: "metal_wall", category: "building", stackMax: 1, building: { tier: "metal", maxHp: 2000, decayDays: 14, damageImmune: false, breach: "explosive_only", storageSlots: 0, restable: false } },
  { id: "campfire", category: "deployable", stackMax: 1, building: { tier: "wood", maxHp: 250, decayDays: 3, damageImmune: false, breach: "explosive_only", storageSlots: 0, restable: false } },
  { id: "furnace", category: "deployable", stackMax: 1, building: { tier: "wood", maxHp: 1000, decayDays: 7, damageImmune: false, breach: "explosive_only", storageSlots: 0, restable: false } },
  { id: "workbench", category: "deployable", stackMax: 1, building: { tier: "wood", maxHp: 500, decayDays: 7, damageImmune: false, breach: "explosive_only", storageSlots: 0, restable: false } },
  { id: "wood_storage_box", category: "deployable", stackMax: 1, building: { tier: "wood", maxHp: 500, decayDays: 7, damageImmune: false, breach: "explosive_only", storageSlots: 12, restable: false } },
  { id: "sleeping_bag", category: "deployable", stackMax: 1, building: { tier: "wood", maxHp: 250, decayDays: 3, damageImmune: false, breach: "melee", storageSlots: 0, restable: true } },
];
