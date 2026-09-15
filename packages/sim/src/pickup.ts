/**
 * Ground pickups and loot (GDD §7, §8, §21.9).
 *
 * - Ground pickups merge within 1.5 m when item id AND blueprint payload
 *   match; they despawn after their catalog timer (GDD §8).
 * - World cap: 400 loose dropped item stacks (GDD §7, loot.max_ground_stacks).
 * - A death creates exactly one corpse; corpses are lootable like
 *   containers - the server proves range and ownership (GDD §21.4: the
 *   client sends an intent, never an outcome).
 * - Class-A durability: a pickup/payout transaction commits atomically;
 *   the confirming event is sent only after commit (GDD §21.9).
 */
import type { EntityStore, PlayerEntity, GroundItemEntity, CorpseEntity } from "./entities.js";
import type { World } from "./world.js";
import { TUNING, ITEMS } from "@dustfall/content";
import type { ItemId, ItemStack } from "@dustfall/contracts";
import { addStack, isMergeable, stackMax } from "./inventory.js";

export interface LootResult {
  ok: boolean;
  reason?: "unknown_source" | "out_of_reach" | "no_room" | "not_a_lootable";
  /** the stack(s) that moved into the player's inventory */
  taken: ItemStack[];
  /** true when the source entity was emptied and forgotten */
  emptied: boolean;
}

const distCm = (ax: number, ay: number, az: number, bx: number, by: number, bz: number): number =>
  Math.hypot(ax - bx, ay - by, az - bz);

/** Count of loose ground-item stacks currently in the world. */
export const groundStackSize = (store: EntityStore): number => {
  let n = 0;
  for (const e of store.values()) if (e.kind === "ground_item") n++;
  return n;
};

/**
 * Drop a stack from the player's inventory to the ground at their
 * position. Subject to the 400-stack world cap; when the cap is reached
 * the drop is rejected (the move stays atomic, GDD §8).
 */
export const dropToGround = (
  world: World,
  store: EntityStore,
  p: PlayerEntity,
  slot: number,
): { ok: boolean; reason?: "unknown_slot" | "empty" | "cap_reached"; stack?: ItemStack } => {
  const s = p.inventory[slot];
  if (slot < 0 || slot >= p.inventory.length) return { ok: false, reason: "unknown_slot" };
  if (s === null || s === undefined) return { ok: false, reason: "empty" };
  const stack: ItemStack = { ...s };
  p.inventory[slot] = null;

  // GDD §8: ground pickups merge within 1.5 m with the same item/payload
  const mergeRadius = (TUNING["loot.ground_pickup_radius"] as number) * 100;
  for (const e of store.values()) {
    if (e.kind !== "ground_item") continue;
    const gi = e as GroundItemEntity;
    if (!isMergeable(gi.stack, stack)) continue;
    if (distCm(gi.position.x, gi.position.y, gi.position.z, p.position.x, p.position.y, p.position.z) > mergeRadius) continue;
    const room = stackMax(stack.itemId) - gi.stack.quantity;
    const take = Math.min(room, stack.quantity);
    if (take > 0) {
      gi.stack = { ...gi.stack, quantity: gi.stack.quantity + take };
      stack.quantity -= take;
    }
    if (stack.quantity <= 0) {
      return { ok: true, stack: { ...gi.stack } };
    }
  }

  if (stack.quantity <= 0) {
    // fully merged into an existing stack
    return { ok: true };
  }
  if (groundStackSize(store) >= (TUNING["loot.max_ground_stacks"] as number)) {
    // cap reached: atomic - the drop is rejected, stack returns to the grid
    p.inventory[slot] = stack;
    return { ok: false, reason: "cap_reached" };
  }
  const gi: GroundItemEntity = {
    id: store.allocate(),
    kind: "ground_item",
    position: { ...p.position },
    stack,
    despawnAtTick: catalogDespawnTicks(stack.itemId) > 0 ? world.clock.tick + catalogDespawnTicks(stack.itemId) : 0,
  };
  store.insert(gi);
  return { ok: true, stack };
};

/**
 * Pick up a ground item or loot a corpse.
 *  - ground item: whole stack moves to the grid; on merge the ground
 *    stack is reduced/removed;
 *  - corpse: the player takes whole stacks one by one (stable slot
 *    order) until the grid is full; the corpse remains if it still
 *    holds anything.
 * Range is proven server-side (loot.pickup_reach_m, GDD §21.4).
 */
export const loot = (
  _world: World,
  store: EntityStore,
  p: PlayerEntity,
  sourceEntityId: string,
): LootResult => {
  const source = store.get(sourceEntityId as import("@dustfall/contracts").EntityId);
  if (!source) return { ok: false, reason: "unknown_source", taken: [], emptied: false };
  if (p.dead) return { ok: false, reason: "unknown_source", taken: [], emptied: false };

  const reach = (TUNING["loot.pickup_reach_m"] as number) * 100;
  if (distCm(p.position.x, p.position.y, p.position.z, source.position.x, source.position.y, source.position.z) > reach) {
    return { ok: false, reason: "out_of_reach", taken: [], emptied: false };
  }

  if (source.kind === "ground_item") {
    const gi = source as GroundItemEntity;
    const left = addStack(p.inventory, gi.stack.itemId, gi.stack.quantity, gi.stack.payload);
    if (left === gi.stack.quantity) {
      return { ok: false, reason: "no_room", taken: [], emptied: false };
    }
    const taken: ItemStack[] = [{ ...gi.stack, quantity: gi.stack.quantity - left }];
    if (left === 0) {
      store.remove(gi.id);
    } else {
      gi.stack = { ...gi.stack, quantity: left };
    }
    return { ok: true, taken, emptied: left === 0 };
  }

  if (source.kind === "corpse") {
    const corpse = source as CorpseEntity;
    const taken: ItemStack[] = [];
    // stable slot order: take whole stacks from the front
    for (let i = 0; i < corpse.inventory.length; i++) {
      const s = corpse.inventory[i];
      if (s === null || s === undefined) continue;
      const left = addStack(p.inventory, s.itemId, s.quantity, s.payload);
      if (left === s.quantity) continue; // no room for this stack (yet)
      const got = s.quantity - left;
      taken.push({ ...s, quantity: got });
      if (left === 0) corpse.inventory[i] = null;
      else s.quantity = left;
    }
    if (taken.length === 0) return { ok: false, reason: "no_room", taken, emptied: false };
    const emptied = corpse.inventory.every((s) => s === null || s === undefined);
    if (emptied) store.remove(corpse.id);
    return { ok: true, taken, emptied };
  }

  return { ok: false, reason: "not_a_lootable", taken: [], emptied: false };
};

/** Catalog despawn timer in ticks; 0 (never) stays 0. */
export const catalogDespawnTicks = (itemId: ItemId): number => {
  const def = ITEMS.find((i) => i.id === itemId);
  if (!def || !def.despawnSeconds || def.despawnSeconds <= 0) return 0;
  return Math.round(def.despawnSeconds * 1.25); // game s -> ticks (ADR-0004)
};

/**
 * Despawn tick (GDD §8): ground stacks expire after their catalog timer.
 * Returns the ids of removed stacks so the replication layer can emit
 * forget records.
 */
export const applyGroundDespawn = (world: World, store: EntityStore): string[] => {
  const removed: string[] = [];
  for (const e of store.values()) {
    if (e.kind !== "ground_item") continue;
    const gi = e as GroundItemEntity;
    if (gi.despawnAtTick === 0 || world.clock.tick < gi.despawnAtTick) continue;
    store.remove(gi.id);
    removed.push(gi.id);
  }
  return removed;
};
