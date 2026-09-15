/**
 * M3: crafting, station conversions, blueprint research and structure
 * placement (GDD §9, §10).
 *
 * Authoritative and atomic. A client sends an intent (recipe id, target
 * structure id, or a placement cell); the server proves station, range,
 * ownership, cost and blueprint, then commits. No client may award itself
 * an output (GDD §21.2 / T09).
 *
 * - **Hand craft:** one queue per player (`PlayerEntity.craft`). Output is
 *   granted to the player on completion.
 * - **Station craft (Campfire/Furnace/Workbench):** one queue per placed
 *   structure (`StructureEntity.craft`), GDD §9 "one shared queue per
 *   station". Output goes to the player who started it; if that player is
 *   gone at completion the output drops at the station (never lost).
 * - **Research:** a Workbench + one Research Kit + one unit of a researchable
 *   item permanently teaches its blueprint payload (GDD §9). Instant and
 *   atomic for M3; the 5 s channel and movement-interrupt are M5.
 * - **Placement:** consume one inventory item of a building/deployable
 *   category and spawn a `StructureEntity` within range and spacing.
 */
import { ITEMS, RECIPES, BLUEPRINTS } from "@dustfall/content";
import { TUNING } from "@dustfall/content";
import type { Vec3, ItemStack } from "@dustfall/contracts";
import type { EntityStore, PlayerEntity, StructureEntity } from "./entities.js";
import type { World } from "./world.js";
import { spawnGroundItem } from "./pickup.js";

const num = (k: string): number => {
  const v = TUNING[k];
  return typeof v === "number" ? v : 0;
};

export type CraftReason =
  | "unknown_recipe"
  | "already_crafting"
  | "wrong_station"
  | "missing_blueprint"
  | "cannot_afford"
  | "no_room"
  | "structure_not_found"
  | "wrong_structure"
  | "out_of_reach"
  | "not_owner"
  | "not_researchable"
  | "already_known"
  | "unknown_item"
  | "not_a_structure"
  | "unknown_slot"
  | "out_of_reach_place"
  | "too_close"
  | "structure_cap"
  | "empty_slot";

export interface CraftStartResult {
  ok: boolean;
  reason?: CraftReason;
  /** set when the craft begins: the completesAtTick */
  completesAtTick?: number;
}

const distCm = (a: Vec3, b: Vec3): number => {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
};

const hasItem = (p: PlayerEntity, itemId: string, qty: number): boolean => {
  let n = 0;
  for (const s of p.inventory) if (s && s.itemId === itemId) n += s.quantity;
  return n >= qty;
};

/** Atomically deduct a recipe's input costs from the player's grid.
 *  Returns false (and changes nothing) if the player cannot afford it. */
const deduct = (p: PlayerEntity, recipeId: string): boolean => {
  const rec = RECIPES.find((r) => r.id === recipeId);
  if (!rec) return false;
  // verify all costs first
  for (const inp of rec.inputs) if (!hasItem(p, inp.itemId, inp.quantity)) return false;
  for (const inp of rec.inputs) {
    let left = inp.quantity;
    for (let i = 0; i < p.inventory.length && left > 0; i++) {
      const s = p.inventory[i];
      if (!s || s.itemId !== inp.itemId) continue;
      const take = Math.min(left, s.quantity);
      s.quantity -= take;
      if (s.quantity === 0) p.inventory[i] = null;
      left -= take;
    }
  }
  return true;
};

/** Grant a recipe's output to a player. Returns false (and drops nothing)
 *  only if there is nowhere to put it; caller then drops to the given
 *  position. */
const grantOutput = (p: PlayerEntity, recipeId: string): boolean => {
  const rec = RECIPES.find((r) => r.id === recipeId);
  if (!rec) return false;
  const stackMax = ITEMS.find((i) => i.id === rec.outputItemId)?.stackMax ?? 1;
  let left = rec.outputQuantity;
  // fill mergeable stacks first
  for (let i = 0; i < p.inventory.length && left > 0; i++) {
    const s = p.inventory[i];
    if (s && s.itemId === rec.outputItemId && s.quantity < stackMax) {
      const take = Math.min(left, stackMax - s.quantity);
      s.quantity += take;
      left -= take;
    }
  }
  // then empty slots
  for (let i = 0; i < p.inventory.length && left > 0; i++) {
    if (p.inventory[i]) continue;
    const take = Math.min(left, stackMax);
    p.inventory[i] = { itemId: rec.outputItemId, quantity: take };
    left -= take;
  }
  return left === 0;
};

/**
 * Begin a craft. For a hand recipe, start the player's queue. For a station
 * recipe, the player must be in reach of a placed structure matching the
 * recipe's station; the structure's queue is used.
 */
export const startCraft = (world: World, store: EntityStore, p: PlayerEntity, recipeId: string, structureEntityId?: string): CraftStartResult => {
  const rec = RECIPES.find((r) => r.id === recipeId);
  if (!rec) return { ok: false, reason: "unknown_recipe" };
  if (rec.requiresBlueprint && !p.blueprints.includes(rec.requiresBlueprint)) {
    return { ok: false, reason: "missing_blueprint" };
  }
  // affordability (hand and station both pay from the player's grid)
  for (const inp of rec.inputs) if (!hasItem(p, inp.itemId, inp.quantity)) return { ok: false, reason: "cannot_afford" };

  if (rec.station === "hand") {
    if (p.craft) return { ok: false, reason: "already_crafting" };
    deduct(p, recipeId);
    p.craft = { recipeId, completesAtTick: world.clock.tick + rec.timeTicks };
    return { ok: true, completesAtTick: p.craft.completesAtTick };
  }

  // station craft: require the matching placed structure in reach
  if (!structureEntityId) return { ok: false, reason: "structure_not_found" };
  const st = store.get(structureEntityId) as StructureEntity | undefined;
  if (!st || st.kind !== "structure") return { ok: false, reason: "structure_not_found" };
  if (st.contentId !== rec.station) return { ok: false, reason: "wrong_structure" };
  if (distCm(p.position, st.position) > num("craft.reach_m") * 100) return { ok: false, reason: "out_of_reach" };
  if (st.craft) return { ok: false, reason: "already_crafting" };
  deduct(p, recipeId);
  st.craft = { recipeId, completesAtTick: world.clock.tick + rec.timeTicks, startedBy: p.playerId };
  return { ok: true, completesAtTick: st.craft.completesAtTick };
};

/**
 * Advance active crafts. Returns events for completed crafts this tick.
 * Called once per tick from the tick loop (system step 7, after survival).
 */
export const advanceCrafts = (
  world: World,
  store: EntityStore,
): Array<{ playerId: string; recipeId: string; structureEntityId?: string; itemId: string; quantity: number; dropped: boolean }> => {
  const done: Array<{ playerId: string; recipeId: string; structureEntityId?: string; itemId: string; quantity: number; dropped: boolean }> = [];
  const tick = world.clock.tick;

  // hand crafts
  for (const e of store.values()) {
    if (e.kind !== "player") continue;
    const p = e as PlayerEntity;
    if (!p.craft || p.dead) continue;
    if (tick < p.craft.completesAtTick) continue;
    const recipeId = p.craft.recipeId;
    p.craft = null;
    const rec = RECIPES.find((r) => r.id === recipeId);
    if (!rec) continue;
    const fit = grantOutput(p, recipeId);
    if (!fit) {
      // inventory full at completion: drop the whole output at the player
      spawnGroundItem(world, store, rec.outputItemId, rec.outputQuantity, p.position);
      done.push({ playerId: p.playerId, recipeId, itemId: rec.outputItemId, quantity: rec.outputQuantity, dropped: true });
    } else {
      done.push({ playerId: p.playerId, recipeId, itemId: rec.outputItemId, quantity: rec.outputQuantity, dropped: false });
    }
  }

  // station crafts
  for (const e of store.values()) {
    if (e.kind !== "structure") continue;
    const st = e as StructureEntity;
    if (!st.craft) continue;
    if (tick < st.craft.completesAtTick) continue;
    const { recipeId, startedBy } = st.craft;
    st.craft = null;
    const rec = RECIPES.find((r) => r.id === recipeId);
    if (!rec) continue;
    const owner = [...store.values()].find((x) => x.kind === "player" && x.playerId === startedBy) as PlayerEntity | undefined;
    let dropped = false;
    if (owner && !owner.dead) {
      if (!grantOutput(owner, recipeId)) {
        spawnGroundItem(world, store, rec.outputItemId, rec.outputQuantity, owner.position);
        dropped = true;
      }
    } else {
      // starter gone: drop at the station so the output is never lost
      spawnGroundItem(world, store, rec.outputItemId, rec.outputQuantity, st.position);
      dropped = true;
    }
    done.push({ playerId: startedBy, recipeId, structureEntityId: st.id, itemId: rec.outputItemId, quantity: rec.outputQuantity, dropped });
  }
  return done;
};

/**
 * Research a blueprint at a Workbench (GDD §9): one Research Kit + one unit
 * of a researchable item → permanently learn the item's payload. Refuses
 * default recipes, loot-only items and an already-known payload.
 */
export const research = (
  _world: World,
  store: EntityStore,
  p: PlayerEntity,
  structureEntityId: string,
  itemId: string,
): { ok: boolean; reason?: CraftReason; payload?: string } => {
  const st = store.get(structureEntityId) as StructureEntity | undefined;
  if (!st || st.kind !== "structure" || st.contentId !== "workbench") return { ok: false, reason: "wrong_structure" };
  if (distCm(p.position, st.position) > num("craft.reach_m") * 100) return { ok: false, reason: "out_of_reach" };

  const item = ITEMS.find((i) => i.id === itemId);
  if (!item?.researchable) return { ok: false, reason: "not_researchable" };
  const payload = item.researchable.blueprintPayload;
  if (p.blueprints.includes(payload)) return { ok: false, reason: "already_known" };

  if (!hasItem(p, "research_kit", 1)) return { ok: false, reason: "cannot_afford" };
  if (!hasItem(p, itemId, 1)) return { ok: false, reason: "cannot_afford" };

  // deduct one kit + one of the item
  let kit = 1;
  for (let i = 0; i < p.inventory.length && kit > 0; i++) {
    const s = p.inventory[i];
    if (s && s.itemId === "research_kit") {
      s.quantity -= kit;
      if (s.quantity === 0) p.inventory[i] = null;
      kit = 0;
    }
  }
  let sample = 1;
  for (let i = 0; i < p.inventory.length && sample > 0; i++) {
    const s = p.inventory[i];
    if (s && s.itemId === itemId) {
      s.quantity -= sample;
      if (s.quantity === 0) p.inventory[i] = null;
      sample = 0;
    }
  }
  p.blueprints.push(payload);
  return { ok: true, payload };
};

/**
 * Place a structure from an inventory item (GDD §10). Consumes one item of
 * a building/deployable category and spawns a StructureEntity. Server proves
 * range, spacing and per-player cap; the client ghost is provisional.
 */
export const placeStructure = (
  world: World,
  store: EntityStore,
  p: PlayerEntity,
  slot: number,
  pos: Vec3,
): { ok: boolean; reason?: CraftReason; structureEntityId?: string } => {
  if (slot < 0 || slot >= p.inventory.length) return { ok: false, reason: "unknown_slot" };
  const s = p.inventory[slot];
  if (!s) return { ok: false, reason: "empty_slot" };
  const def = ITEMS.find((i) => i.id === s.itemId);
  if (!def || (def.category !== "building" && def.category !== "deployable")) return { ok: false, reason: "not_a_structure" };

  if (distCm(p.position, pos) > num("build.place_reach_m") * 100) return { ok: false, reason: "out_of_reach_place" };

  // per-player structure cap
  let owned = 0;
  for (const e of store.values()) if (e.kind === "structure" && e.ownerId === p.playerId) owned++;
  if (owned >= num("build.max_structures_per_player")) return { ok: false, reason: "structure_cap" };

  // min spacing to any existing structure
  const minSpacing = num("build.min_spacing_m") * 100;
  for (const e of store.values()) {
    if (e.kind !== "structure") continue;
    if (distCm(pos, e.position) < minSpacing) return { ok: false, reason: "too_close" };
  }

  // consume the item
  s.quantity -= 1;
  if (s.quantity === 0) p.inventory[slot] = null;

  const hp = def.building?.maxHp ?? 100;
  const storageSlots = def.building?.storageSlots ?? 0;
  const structure: StructureEntity = {
    id: store.allocate(),
    kind: "structure",
    contentId: s.itemId,
    position: { ...pos },
    ownerId: p.playerId,
    craft: null,
    hp,
    maxHp: hp,
    storage: new Array<ItemStack | null>(storageSlots).fill(null),
    lastMaintainedAtTick: world.clock.tick,
  };
  store.insert(structure);
  return { ok: true, structureEntityId: structure.id };
};

/** Blueprints known to a player (for save/restore + tests). */
export const knownBlueprints = (p: PlayerEntity): string[] => [...p.blueprints];

export { BLUEPRINTS };
