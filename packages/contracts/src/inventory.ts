import type { ItemId, BlueprintId } from "./ids.js";

export interface ItemStack {
  itemId: ItemId;
  quantity: number;
  payload?: BlueprintId;
}

/** 36-slot grid per GDD §8: 0..27 main, 28..35 hotbar. */
export const INVENTORY_SLOTS = 36;
export const HOTBAR_OFFSET = 28;
export const HOTBAR_SIZE = 8;

export type EquipmentSlot = "helmet" | "vest" | "pants" | "boots";
export const EQUIPMENT_SLOTS: readonly EquipmentSlot[] = ["helmet", "vest", "pants", "boots"];
