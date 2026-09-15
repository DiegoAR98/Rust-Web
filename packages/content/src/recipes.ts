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
];
