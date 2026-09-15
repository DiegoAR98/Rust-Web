import { describe, expect, it } from "vitest";
import { INVENTORY_SLOTS, type ItemStack, type EquipmentSlot, type BlueprintId } from "@dustfall/contracts";
import {
  addStack,
  canHold,
  countItem,
  equipFromSlot,
  isMergeable,
  moveSlot,
  removeItem,
  splitStack,
  stackMax,
  unequipSlot,
} from "../src/inventory.js";

const grid = (): (ItemStack | null)[] => new Array<ItemStack | null>(INVENTORY_SLOTS).fill(null);

describe("stack rules (GDD 8)", () => {
  it("catalog stackMax: tools stack to 1, resources to their catalog limit", () => {
    expect(stackMax("rock" as ItemStack["itemId"])).toBe(1);
    expect(stackMax("wood" as ItemStack["itemId"])).toBe(100);
    expect(stackMax("bandage" as ItemStack["itemId"])).toBe(10);
  });

  it("mergeable only when item id AND payload match", () => {
    const a = { itemId: "wood" as const, quantity: 5 };
    const b = { itemId: "wood" as const, quantity: 7 };
    const bp = { itemId: "research_kit" as const, quantity: 1, payload: "bp_test" as BlueprintId };
    expect(isMergeable(a, b)).toBe(true);
    expect(isMergeable(a, bp)).toBe(false);
    expect(isMergeable(bp, { itemId: "research_kit" as const, quantity: 1, payload: "bp_other" as BlueprintId })).toBe(false);
    expect(isMergeable(a, { itemId: "wood" as const, quantity: 2, payload: "bp_x" as BlueprintId })).toBe(false);
  });

  it("addStack fills existing mergeable stacks first, honors stackMax", () => {
    const g = grid();
    g[0] = { itemId: "wood" as const, quantity: 95 };
    const left = addStack(g, "wood" as ItemStack["itemId"], 20);
    expect(g[0]?.quantity).toBe(100);
    expect(g[1]?.quantity).toBe(15);
    expect(left).toBe(0);
  });

  it("addStack reports overflow when the grid is full", () => {
    const g = grid();
    for (let i = 0; i < INVENTORY_SLOTS; i++) g[i] = { itemId: "wood" as const, quantity: 100 };
    expect(addStack(g, "stone" as ItemStack["itemId"], 1)).toBe(1);
  });
});

describe("atomic slot moves (GDD 8: whole move accepted or UI rolls back)", () => {
  it("moves a stack to an empty slot", () => {
    const g = grid();
    g[3] = { itemId: "wood" as const, quantity: 12 };
    const r = moveSlot(g, 3, 10);
    expect(r.ok).toBe(true);
    expect(g[3]).toBeNull();
    expect(g[10]?.quantity).toBe(12);
  });

  it("merges up to stackMax and leaves the remainder in the source", () => {
    const g = grid();
    g[0] = { itemId: "wood" as const, quantity: 90 };
    g[5] = { itemId: "wood" as const, quantity: 20 };
    const r = moveSlot(g, 5, 0);
    expect(r.ok).toBe(true);
    expect(g[0]?.quantity).toBe(100);
    expect(g[5]?.quantity).toBe(10);
  });

  it("rejects a move that cannot merge or swap (atomic, no partial state)", () => {
    const g = grid();
    g[0] = { itemId: "wood" as const, quantity: 100 };
    g[1] = { itemId: "stone" as const, quantity: 100 };
    const r = moveSlot(g, 1, 0);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("no_room");
    expect(g[0]?.quantity).toBe(100);
    expect(g[1]?.quantity).toBe(100);
  });

  it("swaps single-stack non-mergeable items", () => {
    const g = grid();
    g[0] = { itemId: "rock" as const, quantity: 1 };
    g[1] = { itemId: "hatchet" as const, quantity: 1 };
    const r = moveSlot(g, 0, 1);
    expect(r.ok).toBe(true);
    expect(g[0]?.itemId).toBe("hatchet");
    expect(g[1]?.itemId).toBe("rock");
  });

  it("rejects out-of-range slots without mutation", () => {
    const g = grid();
    g[0] = { itemId: "wood" as const, quantity: 1 };
    expect(moveSlot(g, -1, 0).ok).toBe(false);
    expect(moveSlot(g, 0, 36).ok).toBe(false);
    expect(moveSlot(g, 400, 0).ok).toBe(false);
    expect(g[0]?.quantity).toBe(1);
  });

  it("hotbar slots are part of the same grid", () => {
    const g = grid();
    g[0] = { itemId: "wood" as const, quantity: 3 };
    const r = moveSlot(g, 0, 29);
    expect(r.ok).toBe(true);
    expect(g[29]?.quantity).toBe(3);
  });
});

describe("split / remove / count", () => {
  it("splitStack moves a partial amount to a mergeable stack", () => {
    const g = grid();
    g[0] = { itemId: "wood" as const, quantity: 10 };
    g[1] = { itemId: "wood" as const, quantity: 40 };
    const r = splitStack(g, 0, 1, 6);
    expect(r.ok).toBe(true);
    expect(g[0]?.quantity).toBe(4);
    expect(g[1]?.quantity).toBe(46);
  });

  it("splitStack refuses to exceed the destination room", () => {
    const g = grid();
    g[0] = { itemId: "wood" as const, quantity: 10 };
    g[1] = { itemId: "wood" as const, quantity: 95 };
    const r = splitStack(g, 0, 1, 6);
    expect(r.ok).toBe(false);
    expect(g[0]?.quantity).toBe(10);
  });

  it("removeItem removes across stacks in slot order", () => {
    const g = grid();
    g[2] = { itemId: "wood" as const, quantity: 30 };
    g[9] = { itemId: "wood" as const, quantity: 20 };
    expect(removeItem(g, "wood" as ItemStack["itemId"], 35)).toBe(35);
    expect(g[2]).toBeNull();
    expect(g[9]?.quantity).toBe(15);
  });

  it("countItem counts only the requested item", () => {
    const g = grid();
    g[0] = { itemId: "wood" as const, quantity: 5 };
    g[1] = { itemId: "stone" as const, quantity: 5 };
    expect(countItem(g, "wood" as ItemStack["itemId"])).toBe(5);
    expect(countItem(g, "stone" as ItemStack["itemId"])).toBe(5);
    expect(countItem(g, "cloth" as ItemStack["itemId"])).toBe(0);
  });
});

describe("equipment slots (GDD 8: helmet, vest, pants, boots)", () => {
  it("equipFromSlot accepts only matching armor catalog slot", () => {
    const g = grid();
    g[4] = { itemId: "cloth_vest" as const, quantity: 1 };
    g[5] = { itemId: "cloth_helmet" as const, quantity: 1 };
    const eq: Partial<Record<EquipmentSlot, ItemStack>> = {};
    expect(equipFromSlot(g, eq, "vest", 4).ok).toBe(true);
    expect(eq.vest?.itemId).toBe("cloth_vest");
    expect(g[4]).toBeNull();
    expect(equipFromSlot(g, eq, "helmet", 4).ok).toBe(false); // slot 4 now empty
    expect(equipFromSlot(g, eq, "boots", 5).ok).toBe(false); // helm is not boots
    expect(eq.boots).toBeUndefined();
  });

  it("equipping over a worn piece returns it to the grid atomically", () => {
    const g = grid();
    g[4] = { itemId: "cloth_vest" as const, quantity: 1 };
    g[5] = { itemId: "cloth_vest" as const, quantity: 1 };
    const eq: Partial<Record<"helmet" | "vest" | "pants" | "boots", ItemStack>> = {};
    eq.vest = { itemId: "cloth_vest" as const, quantity: 1 };
    const r = equipFromSlot(g, eq, "vest", 5);
    expect(r.ok).toBe(true);
    expect(eq.vest?.quantity).toBe(1);
    expect(countItem(g, "cloth_vest" as ItemStack["itemId"])).toBe(2); // returned + remaining
  });

  it("equipping over a worn piece fails atomically when the grid is full", () => {
    const g = grid();
    for (let i = 0; i < INVENTORY_SLOTS; i++) if (i !== 4) g[i] = { itemId: "wood" as const, quantity: 100 };
    g[4] = { itemId: "cloth_vest" as const, quantity: 1 };
    const eq: Partial<Record<"helmet" | "vest" | "pants" | "boots", ItemStack>> = {};
    eq.vest = { itemId: "cloth_vest" as const, quantity: 1 };
    const r = equipFromSlot(g, eq, "vest", 4);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("no_room");
    // no change: old vest still equipped, new vest still in slot 4
    expect(eq.vest?.quantity).toBe(1);
    expect(g[4]?.itemId).toBe("cloth_vest");
  });

  it("unequipSlot returns the worn item to the grid", () => {
    const g = grid();
    const eq: Partial<Record<"helmet" | "vest" | "pants" | "boots", ItemStack>> = {};
    eq.helmet = { itemId: "cloth_helmet" as const, quantity: 1 };
    const r = unequipSlot(g, eq, "helmet");
    expect(r.ok).toBe(true);
    expect(eq.helmet).toBeUndefined();
    expect(countItem(g, "cloth_helmet" as ItemStack["itemId"])).toBe(1);
  });
});

describe("canHold", () => {
  it("accounts for merge room but not incompatible stacks", () => {
    const g = grid();
    for (let i = 0; i < INVENTORY_SLOTS; i++) g[i] = { itemId: "wood" as const, quantity: 100 };
    g[1] = { itemId: "wood" as const, quantity: 90 };
    expect(canHold(g, { itemId: "wood" as const }, 10, 0)).toBe(true);
    expect(canHold(g, { itemId: "wood" as const }, 11, 0)).toBe(false);
    expect(canHold(g, { itemId: "stone" as const }, 1, 0)).toBe(false); // full grid: no room for a new item
  });
});
