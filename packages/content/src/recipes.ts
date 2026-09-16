/**
 * Launch economy spine (GDD Appendix B). Times converted to ticks at 30 Hz.
 * Every row: input ids, quantities, output, craft time, station,
 * blueprint requirement.
 */
import type { RecipeDef } from "./schemas.js";

export const RECIPES: readonly RecipeDef[] = [
  {
    id: "recipe_stone_hatchet",
    outputItemId: "stone_hatchet",
    outputQuantity: 1,
    inputs: [{ itemId: "wood", quantity: 1 }, { itemId: "stone", quantity: 2 }, { itemId: "cloth", quantity: 1 }],
    station: "hand",
    timeTicks: 150, // 5 s
  },
  {
    id: "recipe_hatchet",
    outputItemId: "hatchet",
    outputQuantity: 1,
    inputs: [{ itemId: "wood", quantity: 1 }, { itemId: "metal_fragments", quantity: 1 }],
    station: "hand",
    timeTicks: 240, // 8 s
  },
  {
    id: "recipe_pickaxe",
    outputItemId: "pickaxe",
    outputQuantity: 1,
    inputs: [{ itemId: "wood", quantity: 1 }, { itemId: "metal_fragments", quantity: 1 }, { itemId: "stone", quantity: 1 }],
    station: "workbench",
    timeTicks: 360, // 12 s
    requiresBlueprint: "bp_pickaxe",
  },
  {
    id: "recipe_arrow",
    outputItemId: "arrow",
    outputQuantity: 2,
    inputs: [{ itemId: "wood", quantity: 1 }, { itemId: "stone", quantity: 1 }],
    station: "hand",
    timeTicks: 30, // 1 s
  },
  {
    // M3: the GDD spine table omits the bow, but the M3 exit gate requires
    // it ("first-session arc reaches ... bow"). Authored here as a default
    // hand recipe (limb + stone tip + cloth string), first-session ~30 min.
    id: "recipe_hunting_bow",
    outputItemId: "hunting_bow",
    outputQuantity: 1,
    inputs: [
      { itemId: "wood", quantity: 3 },
      { itemId: "stone", quantity: 1 },
      { itemId: "cloth", quantity: 1 },
    ],
    station: "hand",
    timeTicks: 180, // 6 s
  },
  {
    id: "recipe_bandage",
    outputItemId: "bandage",
    outputQuantity: 1,
    inputs: [{ itemId: "cloth", quantity: 1 }],
    station: "hand",
    timeTicks: 60, // 2 s
  },
  {
    id: "recipe_low_grade_fuel",
    outputItemId: "low_grade_fuel",
    outputQuantity: 4,
    inputs: [{ itemId: "animal_fat", quantity: 2 }, { itemId: "cloth", quantity: 1 }],
    station: "hand",
    timeTicks: 90, // 3 s
  },
  {
    id: "recipe_gunpowder",
    outputItemId: "gunpowder",
    outputQuantity: 2,
    inputs: [{ itemId: "charcoal", quantity: 2 }, { itemId: "sulfur", quantity: 2 }],
    station: "hand",
    timeTicks: 90, // 3 s
  },
  {
    id: "recipe_campfire",
    outputItemId: "campfire",
    outputQuantity: 1,
    inputs: [{ itemId: "wood", quantity: 2 }, { itemId: "stone", quantity: 2 }],
    station: "hand",
    timeTicks: 150, // 5 s
  },
  {
    id: "recipe_furnace",
    outputItemId: "furnace",
    outputQuantity: 1,
    inputs: [{ itemId: "stone", quantity: 5 }, { itemId: "wood", quantity: 5 }],
    station: "hand",
    timeTicks: 360, // 12 s
  },
  {
    id: "recipe_workbench",
    outputItemId: "workbench",
    outputQuantity: 1,
    inputs: [{ itemId: "wood", quantity: 5 }, { itemId: "stone", quantity: 5 }, { itemId: "metal_fragments", quantity: 1 }],
    station: "hand",
    timeTicks: 450, // 15 s
  },
  {
    id: "recipe_sleeping_bag",
    outputItemId: "sleeping_bag",
    outputQuantity: 1,
    inputs: [{ itemId: "cloth", quantity: 3 }],
    station: "hand",
    timeTicks: 240, // 8 s
  },
  {
    id: "recipe_wood_storage_box",
    outputItemId: "wood_storage_box",
    outputQuantity: 1,
    inputs: [{ itemId: "wood", quantity: 10 }],
    station: "hand",
    timeTicks: 180, // 6 s
  },
  {
    id: "recipe_wood_shelter",
    outputItemId: "wood_shelter",
    outputQuantity: 1,
    inputs: [{ itemId: "wood", quantity: 8 }],
    station: "hand",
    timeTicks: 150, // 5 s
  },
  // ---- M4 grid pieces (GDD §10) ----
  {
    id: "recipe_wood_wall",
    outputItemId: "wood_wall",
    outputQuantity: 1,
    inputs: [{ itemId: "wood", quantity: 6 }],
    station: "hand",
    timeTicks: 300, // 10 s
  },
  {
    id: "recipe_wood_door",
    outputItemId: "wood_door",
    outputQuantity: 1,
    inputs: [{ itemId: "wood", quantity: 6 }, { itemId: "metal_fragments", quantity: 1 }],
    station: "hand",
    timeTicks: 450, // 15 s
  },
  {
    id: "recipe_wood_barricade",
    outputItemId: "wood_barricade",
    outputQuantity: 1,
    inputs: [{ itemId: "wood", quantity: 4 }],
    station: "hand",
    timeTicks: 120, // 4 s
  },
  // ---- M3 station conversions (GDD Appendix B: furnace + campfire) ----
  {
    id: "recipe_cooked_rabbit_meat",
    outputItemId: "cooked_rabbit_meat",
    outputQuantity: 1,
    inputs: [{ itemId: "raw_rabbit_meat", quantity: 1 }],
    station: "campfire",
    timeTicks: 90, // 3 s
  },
  {
    id: "recipe_cooked_chicken_meat",
    outputItemId: "cooked_chicken_meat",
    outputQuantity: 1,
    inputs: [{ itemId: "raw_chicken_meat", quantity: 1 }],
    station: "campfire",
    timeTicks: 90, // 3 s
  },
  {
    id: "recipe_metal_fragments",
    outputItemId: "metal_fragments",
    outputQuantity: 1,
    inputs: [{ itemId: "metal_ore", quantity: 1 }],
    station: "furnace",
    timeTicks: 180, // 6 s
  },
  {
    id: "recipe_sulfur",
    outputItemId: "sulfur",
    outputQuantity: 1,
    inputs: [{ itemId: "sulfur_ore", quantity: 1 }],
    station: "furnace",
    timeTicks: 180, // 6 s
  },
  {
    id: "recipe_leather",
    outputItemId: "leather",
    outputQuantity: 1,
    inputs: [{ itemId: "cloth", quantity: 1 }],
    station: "furnace",
    timeTicks: 180, // 6 s
  },
  {
    id: "recipe_charcoal",
    outputItemId: "charcoal",
    outputQuantity: 1,
    inputs: [{ itemId: "wood", quantity: 1 }],
    station: "furnace",
    timeTicks: 180, // 6 s
  },
  // ---- M6 combat (GDD §11 + Appendix B): ammo, explosives, weapons, armor ----
  // The GDD specifies the damage formula + falloff shape, not per-weapon
  // numbers; these rows are the authored vertical-slice values (single data
  // owner: this file), all cross-validated against items.ts.
  {
    id: "recipe_hand_cannon",
    outputItemId: "hand_cannon",
    outputQuantity: 1,
    inputs: [
      { itemId: "wood", quantity: 3 },
      { itemId: "metal_fragments", quantity: 4 },
      { itemId: "cloth", quantity: 1 },
    ],
    station: "workbench",
    timeTicks: 600, // 20 s
  },
  {
    id: "recipe_handmade_shell",
    outputItemId: "handmade_shell",
    outputQuantity: 1,
    inputs: [
      { itemId: "gunpowder", quantity: 1 },
      { itemId: "metal_fragments", quantity: 1 },
    ],
    station: "hand",
    timeTicks: 60, // 2 s
  },
  {
    id: "recipe_nine_mm_pistol",
    outputItemId: "nine_mm_pistol",
    outputQuantity: 1,
    inputs: [
      { itemId: "metal_fragments", quantity: 5 },
      { itemId: "wood", quantity: 2 },
      { itemId: "cloth", quantity: 1 },
    ],
    station: "workbench",
    timeTicks: 720, // 24 s
  },
  {
    id: "recipe_nine_mm_round",
    outputItemId: "nine_mm_round",
    outputQuantity: 4,
    inputs: [
      { itemId: "gunpowder", quantity: 1 },
      { itemId: "metal_fragments", quantity: 1 },
    ],
    station: "hand",
    timeTicks: 90, // 3 s
  },
  {
    id: "recipe_pipe_shotgun",
    outputItemId: "pipe_shotgun",
    outputQuantity: 1,
    inputs: [
      { itemId: "wood", quantity: 3 },
      { itemId: "metal_fragments", quantity: 6 },
      { itemId: "cloth", quantity: 1 },
    ],
    station: "workbench",
    timeTicks: 720, // 24 s
  },
  {
    id: "recipe_shotgun_shell",
    outputItemId: "shotgun_shell",
    outputQuantity: 1,
    inputs: [
      { itemId: "gunpowder", quantity: 2 },
      { itemId: "metal_fragments", quantity: 1 },
      { itemId: "cloth", quantity: 1 },
    ],
    station: "hand",
    timeTicks: 90, // 3 s
  },
  {
    id: "recipe_explosives",
    outputItemId: "explosives",
    outputQuantity: 1,
    inputs: [
      { itemId: "gunpowder", quantity: 4 },
      { itemId: "metal_fragments", quantity: 1 },
    ],
    station: "hand",
    timeTicks: 150, // 5 s
  },
  {
    id: "recipe_hand_grenade",
    outputItemId: "hand_grenade",
    outputQuantity: 1,
    inputs: [
      { itemId: "explosives", quantity: 2 },
      { itemId: "metal_fragments", quantity: 1 },
    ],
    station: "hand",
    timeTicks: 180, // 6 s
  },
  {
    id: "recipe_explosive_charge",
    outputItemId: "explosive_charge",
    outputQuantity: 1,
    inputs: [
      { itemId: "explosives", quantity: 3 },
      { itemId: "metal_fragments", quantity: 1 },
      { itemId: "cloth", quantity: 1 },
    ],
    station: "workbench",
    timeTicks: 240, // 8 s
    requiresBlueprint: "bp_explosive_charge",
  },
  {
    id: "recipe_assault_rifle",
    outputItemId: "assault_rifle",
    outputQuantity: 1,
    inputs: [
      { itemId: "metal_fragments", quantity: 8 },
      { itemId: "wood", quantity: 4 },
      { itemId: "cloth", quantity: 2 },
    ],
    station: "workbench",
    timeTicks: 900, // 30 s
    requiresBlueprint: "bp_assault_rifle",
  },
  {
    id: "recipe_bolt_action_rifle",
    outputItemId: "bolt_action_rifle",
    outputQuantity: 1,
    inputs: [
      { itemId: "metal_fragments", quantity: 10 },
      { itemId: "wood", quantity: 6 },
      { itemId: "cloth", quantity: 2 },
    ],
    station: "workbench",
    timeTicks: 1200, // 40 s
    requiresBlueprint: "bp_bolt_action_rifle",
  },
  {
    id: "recipe_rifle_round",
    outputItemId: "rifle_round",
    outputQuantity: 2,
    inputs: [
      { itemId: "gunpowder", quantity: 1 },
      { itemId: "metal_fragments", quantity: 1 },
      { itemId: "explosives", quantity: 1 },
    ],
    station: "hand",
    timeTicks: 120, // 4 s
  },
  {
    id: "recipe_leather_helmet",
    outputItemId: "leather_helmet",
    outputQuantity: 1,
    inputs: [{ itemId: "leather", quantity: 3 }],
    station: "hand",
    timeTicks: 300, // 10 s
  },
  {
    id: "recipe_leather_vest",
    outputItemId: "leather_vest",
    outputQuantity: 1,
    inputs: [{ itemId: "leather", quantity: 5 }],
    station: "hand",
    timeTicks: 420, // 14 s
  },
  {
    id: "recipe_leather_pants",
    outputItemId: "leather_pants",
    outputQuantity: 1,
    inputs: [{ itemId: "leather", quantity: 4 }],
    station: "hand",
    timeTicks: 360, // 12 s
  },
  {
    id: "recipe_leather_boots",
    outputItemId: "leather_boots",
    outputQuantity: 1,
    inputs: [{ itemId: "leather", quantity: 2 }],
    station: "hand",
    timeTicks: 180, // 6 s
  },
  {
    id: "recipe_ballistic_helmet",
    outputItemId: "ballistic_helmet",
    outputQuantity: 1,
    inputs: [
      { itemId: "leather", quantity: 2 },
      { itemId: "metal_fragments", quantity: 3 },
    ],
    station: "workbench",
    timeTicks: 600, // 20 s
    requiresBlueprint: "bp_ballistic_helmet",
  },
  {
    id: "recipe_ballistic_vest",
    outputItemId: "ballistic_vest",
    outputQuantity: 1,
    inputs: [
      { itemId: "leather", quantity: 3 },
      { itemId: "metal_fragments", quantity: 4 },
    ],
    station: "workbench",
    timeTicks: 720, // 24 s
    requiresBlueprint: "bp_ballistic_vest",
  },
  {
    id: "recipe_ballistic_pants",
    outputItemId: "ballistic_pants",
    outputQuantity: 1,
    inputs: [
      { itemId: "leather", quantity: 2 },
      { itemId: "metal_fragments", quantity: 3 },
    ],
    station: "workbench",
    timeTicks: 600, // 20 s
    requiresBlueprint: "bp_ballistic_pants",
  },
  {
    id: "recipe_ballistic_boots",
    outputItemId: "ballistic_boots",
    outputQuantity: 1,
    inputs: [
      { itemId: "leather", quantity: 1 },
      { itemId: "metal_fragments", quantity: 2 },
    ],
    station: "workbench",
    timeTicks: 480, // 16 s
    requiresBlueprint: "bp_ballistic_boots",
  },
];
