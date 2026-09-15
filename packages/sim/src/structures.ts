/**
 * M4: structure attack (breach), storage, rest and decay (GDD §10).
 *
 * - **Attack:** a tool swing against a structure deals `toolMultiplier ×
 *   25` damage, but only when the piece's authored breach rule allows it
 *   ("melee"). Walls/stations are "explosive_only" (immune to melee, M6
 *   charges) and foundations/pillars/ceilings are "immune". No swing
 *   penetrates a wall (GDD §11).
 * - **Destruction:** at 0 hp the structure despawns and its storage + the
 *   item body drop at the position (nothing is ever lost, GDD §21.5).
 * - **Storage:** any live player within 3 m may deposit/withdraw one
 *   stack into/out of a storage structure's slots (owner-agnostic: bases
 *   are shared; M7 adds locks).
 * - **Rest:** standing within 3 m of a sleeping bag regenerates health
 *   slowly (the full sleep channel is M5).
 * - **Decay (GDD §10):** unattended structures lose integrity on a
 *   tier-specific timer; the owner within decay.owner_refresh_m refreshes
 *   it. Integrity reaching 0 destroys the structure the same way a
 *   breach does.
 */
import { ITEMS, TUNING } from "@dustfall/content";
import { VITAL_LIMITS } from "@dustfall/contracts";
import type { EntityStore, PlayerEntity, StructureEntity } from "./entities.js";
import type { World } from "./world.js";
import { spawnGroundItem } from "./pickup.js";

export type AttackStructureReason =
  | "dead"
  | "no_tool"
  | "cooldown"
  | "unknown_structure"
  | "out_of_reach"
  | "not_melee_breached"
  | "already_destroyed";

export interface AttackStructureResult {
  ok: boolean;
  reason?: AttackStructureReason;
  damage: number;
  hpAfter: number;
  destroyed: boolean;
}

const REACH_CM = 300; // gather.swing_reach_m is 3 m

/**
 * Resolve a tool swing against a structure. Charges the swing cooldown on
 * any valid-target swing (same contract as node gathering).
 */
export const attackStructure = (
  world: World,
  store: EntityStore,
  p: PlayerEntity,
  structureEntityId: string,
): AttackStructureResult => {
  const fail = (reason: AttackStructureReason, hpAfter = 0): AttackStructureResult => ({ ok: false, reason, damage: 0, hpAfter, destroyed: false });
  if (p.dead) return fail("dead");
  const cooldown = TUNING["gather.swing_cooldown_ticks"] as number;
  if (world.clock.tick < p.swingCooldownUntilTick) return fail("cooldown");

  const target = store.get(structureEntityId as import("@dustfall/contracts").EntityId);
  if (!target || target.kind !== "structure") return fail("unknown_structure");
  const st = target as StructureEntity;
  if (st.hp <= 0) return fail("already_destroyed");

  const dx = p.position.x - st.position.x;
  const dy = p.position.y - st.position.y;
  const dz = p.position.z - st.position.z;
  if (Math.hypot(dx, dy, dz) > REACH_CM) return fail("out_of_reach");

  const held = p.heldItemId ? p.inventory.find((s) => s !== null && s !== undefined && s.itemId === p.heldItemId) : undefined;
  const toolDef = held ? ITEMS.find((i) => i.id === held.itemId) : undefined;
  if (!toolDef?.tool) return fail("no_tool");

  // charge the swing (calories + cooldown) even when the piece is immune:
  // the player swung at the world and the world moved on.
  p.vitals.calories = Math.max(0, p.vitals.calories - toolDef.tool.swingCalories);
  p.swingCooldownUntilTick = world.clock.tick + cooldown;

  const def = ITEMS.find((i) => i.id === st.contentId);
  if (def?.building?.breach !== "melee") return fail("not_melee_breached", st.hp);

  const damage = toolDef.tool.toolMultiplier * 25;
  st.hp = Math.max(0, st.hp - damage);
  if (st.hp === 0) destroyStructure(world, store, st);
  return { ok: true, damage, hpAfter: st.hp, destroyed: st.hp === 0 };
};

/**
 * Remove a broken structure: drop its storage contents and one copy of its
 * own item at its position, then delete it. Nothing is lost (GDD §21.5).
 */
export const destroyStructure = (
  world: World,
  store: EntityStore,
  st: StructureEntity,
): void => {
  const at = st.position;
  for (const slot of st.storage) {
    if (slot) spawnGroundItem(world, store, slot.itemId, slot.quantity, at);
  }
  spawnGroundItem(world, store, st.contentId as import("@dustfall/contracts").ItemId, 1, at);
  st.storage = [];
  st.hp = 0;
  st.craft = null;
  store.remove(st.id);
};

// ---------------------------------------------------------------------------
// Storage (GDD §10: shared storage; locks are M7)
// ---------------------------------------------------------------------------

export type StorageReason =
  | "unknown_structure"
  | "out_of_reach"
  | "not_storage"
  | "bad_slot"
  | "source_empty"
  | "target_full"
  | "stack_mismatch"
  | "same_stack";

export const depositToStructure = (
  _world: World,
  store: EntityStore,
  p: PlayerEntity,
  structureEntityId: string,
  fromSlot: number,
  toSlot: number,
): { ok: boolean; reason?: StorageReason } => {
  const check = storageCheck(store, p, structureEntityId, toSlot);
  if ("reason" in check) return { ok: false, reason: check.reason };
  const st = check.structure;
  if (fromSlot < 0 || fromSlot >= p.inventory.length || toSlot >= st.storage.length) return { ok: false, reason: "bad_slot" };
  const src = p.inventory[fromSlot];
  if (!src) return { ok: false, reason: "source_empty" };
  const dst = st.storage[toSlot];
  if (dst) {
    if (dst.itemId !== src.itemId) return { ok: false, reason: "target_full" };
    const def = ITEMS.find((i) => i.id === src.itemId);
    if (dst.quantity + src.quantity > (def?.stackMax ?? 1)) return { ok: false, reason: "target_full" };
    dst.quantity += src.quantity;
  } else {
    st.storage[toSlot] = { ...src };
  }
  p.inventory[fromSlot] = null;
  return { ok: true };
};

export const withdrawFromStructure = (
  _world: World,
  store: EntityStore,
  p: PlayerEntity,
  structureEntityId: string,
  fromSlot: number,
  toSlot: number,
): { ok: boolean; reason?: StorageReason } => {
  const check = storageCheck(store, p, structureEntityId, fromSlot);
  if ("reason" in check) return { ok: false, reason: check.reason };
  const st = check.structure;
  const src = st.storage[fromSlot];
  if (!src) return { ok: false, reason: "source_empty" };
  if (toSlot < 0 || toSlot >= p.inventory.length) return { ok: false, reason: "bad_slot" };
  const dst = p.inventory[toSlot];
  if (dst) {
    if (dst.itemId !== src.itemId) return { ok: false, reason: "target_full" };
    const def = ITEMS.find((i) => i.id === src.itemId);
    if (dst.quantity + src.quantity > (def?.stackMax ?? 1)) return { ok: false, reason: "target_full" };
    dst.quantity += src.quantity;
  } else {
    p.inventory[toSlot] = { ...src };
  }
  st.storage[fromSlot] = null;
  return { ok: true };
};

type StorageOk = { structure: StructureEntity };
type StorageFail = { reason: StorageReason };
const storageCheck = (store: EntityStore, p: PlayerEntity, structureEntityId: string, _slot: number): StorageOk | StorageFail => {
  const target = store.get(structureEntityId as import("@dustfall/contracts").EntityId);
  if (!target || target.kind !== "structure") return { reason: "unknown_structure" };
  const st = target as StructureEntity;
  if (st.storage.length === 0) return { reason: "not_storage" };
  const dx = p.position.x - st.position.x;
  const dy = p.position.y - st.position.y;
  const dz = p.position.z - st.position.z;
  if (Math.hypot(dx, dy, dz) > REACH_CM) return { reason: "out_of_reach" };
  return { structure: st };
};

// ---------------------------------------------------------------------------
// Rest (sleeping bag) — full sleep channel is M5
// ---------------------------------------------------------------------------

/** Restore a little health while standing next to a sleeping bag. */
export const restAtStructure = (
  _world: World,
  store: EntityStore,
  p: PlayerEntity,
  structureEntityId: string,
): { ok: boolean } => {
  if (p.dead) return { ok: false };
  const target = store.get(structureEntityId as import("@dustfall/contracts").EntityId);
  if (!target || target.kind !== "structure") return { ok: false };
  const st = target as StructureEntity;
  const def = ITEMS.find((i) => i.id === st.contentId);
  if (def?.building?.restable !== true) return { ok: false };
  const dx = p.position.x - st.position.x;
  const dy = p.position.y - st.position.y;
  const dz = p.position.z - st.position.z;
  if (Math.hypot(dx, dy, dz) > REACH_CM) return { ok: false };
  p.vitals.health = Math.min(VITAL_LIMITS.maxHealth, p.vitals.health + 1);
  return { ok: true };
};

// ---------------------------------------------------------------------------
// Decay (GDD §10): unattended structures lose integrity on a timer;
// owner proximity refreshes it.
// ---------------------------------------------------------------------------

const TICKS_PER_GAME_DAY = 108_000; // ADR-0004

/**
 * Advance decay for every structure; returns ids of structures destroyed
 * this tick (the tick layer emits their destruction events + forgets).
 */
export const applyStructureDecay = (
  world: World,
  store: EntityStore,
): string[] => {
  const destroyed: string[] = [];
  const refreshCm = (TUNING["decay.owner_refresh_m"] as number) * 100;
  const stepFraction = TUNING["decay.step_fraction"] as number;
  const players: PlayerEntity[] = [];
  for (const e of store.values()) if (e.kind === "player" && !e.dead) players.push(e);

  // collect the structures to destroy FIRST, then destroy: destroyStructure
  // removes from the store and store.values() must not be mutated mid-iteration.
  const toDestroy: StructureEntity[] = [];
  for (const e of store.values()) {
    if (e.kind !== "structure") continue;
    const st = e as StructureEntity;
    if (st.hp <= 0) continue;
    const def = ITEMS.find((i) => i.id === st.contentId);
    if (!def?.building) continue;

    // owner within refresh range -> maintain (no decay, timer refreshed)
    const owner = players.find((pl) => pl.playerId === st.ownerId);
    if (owner) {
      const d = Math.hypot(owner.position.x - st.position.x, owner.position.y - st.position.y, owner.position.z - st.position.z);
      if (d <= refreshCm) {
        st.lastMaintainedAtTick = world.clock.tick;
        continue;
      }
    }

    const stepTicks = Math.round((def.building.decayDays * TICKS_PER_GAME_DAY) / 10);
    if (stepTicks <= 0) continue;
    if (world.clock.tick - st.lastMaintainedAtTick < stepTicks) continue;
    st.lastMaintainedAtTick = world.clock.tick;
    st.hp = Math.max(0, st.hp - Math.max(1, Math.round(st.maxHp * stepFraction)));
    if (st.hp === 0) toDestroy.push(st);
  }
  for (const st of toDestroy) {
    destroyed.push(st.id);
    destroyStructure(world, store, st);
  }
  return destroyed;
};
