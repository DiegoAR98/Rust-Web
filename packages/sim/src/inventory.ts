/**
 * Inventory system (GDD §8).
 *
 * Server-authoritative and atomic: every operation either completes fully or
 * leaves the slot arrays exactly as it found them. Stacks merge only when
 * item id AND blueprint payload match. No client ever sees a confirmed count
 * before the replica accepts the move.
 */
import type { ItemId, EquipmentSlot } from "@dustfall/contracts";
import { INVENTORY_SLOTS, type ItemStack as IStack } from "@dustfall/contracts";
import { ITEMS } from "@dustfall/content";

/** stackMax for an item; catalog is the single source of truth. */
export const stackMax = (itemId: ItemId): number => {
  const def = ITEMS.find((i) => i.id === itemId);
  if (!def) throw new Error(`unknown item ${String(itemId)} (inventory)`);
  return def.stackMax;
};

/**
 * Two stacks are mergeable only when item id AND blueprint payload match
 * (GDD §8). `undefined` payload === no payload.
 */
export const isMergeable = (a: IStack, b: IStack): boolean =>
  a.itemId === b.itemId && (a.payload ?? null) === (b.payload ?? null);

/** Merge `amount` units of `stack` into target slots (0..35, main+hotbar).
 * Returns the remainder that did not fit (0 when fully absorbed).
 * Mutates slots in place; the caller owns atomicity via the higher-level
 * move functions, which verify totals first. */
const absorb = (
  slots: (IStack | null)[],
  stack: IStack,
  amount: number,
  ignoreSlot: number | null,
): number => {
  let left = amount;
  for (let i = 0; i < slots.length && left > 0; i++) {
    if (i === ignoreSlot) continue;
    const cur = slots[i];
    if (cur === null || cur === undefined) {
      const take = Math.min(left, stackMax(stack.itemId));
      slots[i] = { ...stack, quantity: take };
      left -= take;
    } else if (isMergeable(cur, stack)) {
      const take = Math.min(left, stackMax(stack.itemId) - cur.quantity);
      cur.quantity += take;
      left -= take;
    }
  }
  return left;
};

/** True if the player's grid can hold `amount` units of a stack
 *  (itemId + payload) moving out of slot `from` (or null when coming
 *  from outside the grid). */
export const canHold = (
  slots: (IStack | null)[],
  stack: Pick<IStack, "itemId"> & { payload?: IStack["payload"] },
  amount: number,
  ignoreSlot: number | null,
): boolean => {
  let free = 0;
  const max = stackMax(stack.itemId);
  for (let i = 0; i < slots.length; i++) {
    if (i === ignoreSlot) continue;
    const cur = slots[i];
    if (cur === null || cur === undefined) free += max;
    else if (isMergeable(cur, stack as IStack)) free += max - cur.quantity;
  }
  return free >= amount;
};

export interface MoveResult {
  ok: boolean;
  reason?: "unknown_slot" | "empty_source" | "no_room" | "invalid_equipment_slot";
  /** slots changed: [index] pairs, hotbar/main included */
  touched: number[];
}

/**
 * Atomic slot-to-slot move within one 36-slot grid (GDD §8: either the whole
 * move is accepted or the UI rolls back). Merges when mergeable, else
 * transfers the whole stack.
 */
export const moveSlot = (
  slots: (IStack | null)[],
  from: number,
  to: number,
): MoveResult => {
  if (from < 0 || from >= INVENTORY_SLOTS || to < 0 || to >= INVENTORY_SLOTS) {
    return { ok: false, reason: "unknown_slot", touched: [] };
  }
  if (from === to) return { ok: false, reason: "empty_source", touched: [] };
  const src = slots[from];
  if (src === null || src === undefined) return { ok: false, reason: "empty_source", touched: [] };
  const dst = slots[to];

  if (dst === null || dst === undefined) {
    slots[to] = src;
    slots[from] = null;
    return { ok: true, touched: [from, to] };
  }

  if (isMergeable(dst, src)) {
    const room = stackMax(src.itemId) - dst.quantity;
    if (room <= 0) return { ok: false, reason: "no_room", touched: [] };
    const take = Math.min(room, src.quantity);
    dst.quantity += take;
    if (take === src.quantity) slots[from] = null;
    else src.quantity -= take;
    return { ok: true, touched: [from, to] };
  }

  // not mergeable: swap when the destination is a single-stack item we can
  // place in the source slot; otherwise reject (atomic, GDD §8).
  if (dst.quantity === 1 && stackMax(src.itemId) >= 1) {
    slots[from] = dst;
    slots[to] = src;
    return { ok: true, touched: [from, to] };
  }
  return { ok: false, reason: "no_room", touched: [] };
};

/** Equip: take one stack (or whole stack) from slot `from` into equipment
 *  slot `slot`. Only armor items with a matching catalog slot may be worn.
 *  If something is already equipped there, it returns to the main grid. */
export const equipFromSlot = (
  slots: (IStack | null)[],
  equipment: Partial<Record<EquipmentSlot, IStack>>,
  slot: EquipmentSlot,
  from: number,
): MoveResult => {
  const src = slots[from];
  if (src === null || src === undefined || from < 0 || from >= INVENTORY_SLOTS) {
    return { ok: false, reason: from < 0 || from >= INVENTORY_SLOTS ? "unknown_slot" : "empty_source", touched: [] };
  }
  const def = ITEMS.find((i) => i.id === src.itemId);
  if (!def?.armor || def.armor.slot !== slot) {
    return { ok: false, reason: "invalid_equipment_slot", touched: [] };
  }
  const prev = equipment[slot];
  if (prev !== undefined) {
    // return the worn item to the first empty slot or a mergeable slot
    const left = absorb(slots, prev, prev.quantity, from);
    if (left > 0) {
      // atomic: nothing changed
      return { ok: false, reason: "no_room", touched: [] };
    }
  }
  delete equipment[slot];
  equipment[slot] = { ...src, quantity: 1 };
  if (src.quantity === 1) slots[from] = null;
  else src.quantity -= 1;
  return { ok: true, touched: [from] };
};

/** Unequip back to the grid. */
export const unequipSlot = (
  slots: (IStack | null)[],
  equipment: Partial<Record<EquipmentSlot, IStack>>,
  slot: EquipmentSlot,
): MoveResult => {
  const worn = equipment[slot];
  if (worn === undefined) return { ok: false, reason: "empty_source", touched: [] };
  const left = absorb(slots, worn, worn.quantity, null);
  if (left > 0) return { ok: false, reason: "no_room", touched: [] };
  delete equipment[slot];
  return { ok: true, touched: [] };
};

/** Add `amount` units of an item to the grid. Returns remainder that did
 *  not fit (caller drops to ground or rejects the transaction). */
export const addStack = (slots: (IStack | null)[], itemId: ItemId, amount: number, payload?: IStack["payload"]): number => {
  return absorb(slots, { itemId, quantity: amount, ...(payload !== undefined ? { payload } : {}) }, amount, null);
};

/** Count of an item (optionally per payload) across the whole grid. */
export const countItem = (slots: (IStack | null)[], itemId: ItemId, payload?: IStack["payload"]): number => {
  let n = 0;
  for (const s of slots) {
    if (s && s.itemId === itemId && (payload === undefined || (s.payload ?? null) === payload)) n += s.quantity;
  }
  return n;
};

/** Remove up to `amount` units of an item. Returns how many were removed. */
export const removeItem = (slots: (IStack | null)[], itemId: ItemId, amount: number): number => {
  let left = amount;
  for (let i = 0; i < slots.length && left > 0; i++) {
    const s = slots[i];
    if (!s || s.itemId !== itemId) continue;
    const take = Math.min(left, s.quantity);
    s.quantity -= take;
    if (s.quantity === 0) slots[i] = null;
    left -= take;
  }
  return amount - left;
};

/** Split a stack: move `take` units from `from` to `to` (to may be empty or
 *  a mergeable stack). */
export const splitStack = (slots: (IStack | null)[], from: number, to: number, take: number): MoveResult => {
  const src = slots[from];
  if (src === null || src === undefined || take <= 0 || take > src.quantity) {
    return { ok: false, reason: "empty_source", touched: [] };
  }
  const dst = slots[to];
  if (dst !== null && dst !== undefined && !isMergeable(dst, src)) {
    return { ok: false, reason: "no_room", touched: [] };
  }
  const room = dst === null || dst === undefined ? stackMax(src.itemId) : stackMax(src.itemId) - dst.quantity;
  if (take > room) return { ok: false, reason: "no_room", touched: [] };
  if (dst === null || dst === undefined) slots[to] = { ...src, quantity: take };
  else dst.quantity += take;
  src.quantity -= take;
  if (src.quantity === 0) slots[from] = null;
  return { ok: true, touched: [from, to] };
};
