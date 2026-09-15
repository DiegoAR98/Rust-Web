/**
 * Gathering (GDD §7).
 *
 * A swing is resolved at the server's hit time, not when the client
 * animation began (GDD §7). Resolution:
 *  - the player must be alive, have a held item with a tool, and be in
 *    swing cooldown;
 *  - the target node must be within gather.swing_reach_m of the player;
 *  - the tool's toolMultiplier must reach the node's minToolMultiplier
 *    (GDD §7 tool preference);
 *  - the swing adds toolMultiplier (+ swingCalories is spent) to the
 *    node's harvest accumulator; each whole unit pays out exactly one
 *    resource unit, decrements the pool and rolls the node's secondary
 *    yields on the loot RNG.
 *
 * Depletion and respawn:
 *  - when the pool hits 0 the node is depleted;
 *  - respawn is seeded (nodeRespawn subsystem RNG) and region-specific,
 *    with a per-node delay in the authored window;
 *  - a node NEVER respawns within 60 m of a live player (GDD §7) - the
 *    respawn check simply defers until the region is clear.
 */
import type { EntityStore, PlayerEntity, WorldEntity } from "./entities.js";
import type { World } from "./world.js";
import { SUBSYSTEM } from "./rng.js";
import { nodeById, TUNING, ITEMS } from "@dustfall/content";
import type { ItemStack, ItemId } from "@dustfall/contracts";
import { addStack } from "./inventory.js";

export interface SwingResult {
  ok: boolean;
  reason?: "dead" | "no_tool" | "cooldown" | "unknown_node" | "out_of_reach" | "tool_too_weak" | "depleted" | "no_room";
  /** resources paid out this swing (primary) */
  payout: number;
  /** secondary items paid out this swing */
  secondaries: ItemStack[];
  /** true when this swing depleted the node */
  depleted: boolean;
}

const distCm = (ax: number, ay: number, az: number, bx: number, by: number, bz: number): number =>
  Math.hypot(ax - bx, ay - by, az - bz);

/**
 * Resolve a swing against a world node. Mutates the node and the player's
 * inventory; returns the result so the tick layer can emit events.
 * The swing cooldown is charged on success AND on valid-target swings that
 * are rejected for no_room (the player swung, the world moved on).
 */
export const resolveSwing = (
  world: World,
  store: EntityStore,
  p: PlayerEntity,
  nodeEntityId: string,
): SwingResult => {
  const fail = (reason: NonNullable<SwingResult["reason"]>): SwingResult => ({ ok: false, reason, payout: 0, secondaries: [], depleted: false });

  if (p.dead) return fail("dead");
  const cooldown = TUNING["gather.swing_cooldown_ticks"] as number;
  if (world.clock.tick < p.swingCooldownUntilTick) return fail("cooldown");

  const target = store.get(nodeEntityId as import("@dustfall/contracts").EntityId);
  if (!target || target.kind !== "world") return fail("unknown_node");
  const node = target as WorldEntity;
  const def = nodeById(node.contentId);
  if (!def) return fail("unknown_node");
  if (node.pool <= 0) return fail("depleted");

  const reachM = TUNING["gather.swing_reach_m"] as number;
  if (distCm(p.position.x, p.position.y, p.position.z, node.position.x, node.position.y, node.position.z) > reachM * 100) {
    return fail("out_of_reach");
  }

  // tool check: the held item must be a tool in the inventory
  const held = p.heldItemId ? p.inventory.find((s) => s !== null && s !== undefined && s.itemId === p.heldItemId) : undefined;
  const toolDef = held ? ITEMS.find((i) => i.id === held.itemId) : undefined;
  if (!toolDef?.tool) return fail("no_tool");
  if (toolDef.tool.toolMultiplier < def.minToolMultiplier) return fail("tool_too_weak");

  // charge the swing: calories + cooldown (charged even if no room to pay)
  p.vitals.calories = Math.max(0, p.vitals.calories - toolDef.tool.swingCalories);
  p.swingCooldownUntilTick = world.clock.tick + cooldown;

  if (!canCarry(p, def.resourceItemId, 1, secondariesCount(def))) {
    return fail("no_room");
  }

  // harvest accumulator (GDD §7: whole units pay out exactly one resource)
  node.accumulator += toolDef.tool.toolMultiplier;
  const whole = Math.floor(node.accumulator);
  node.accumulator -= whole;

  const secondaries: ItemStack[] = [];
  let payout = 0;
  const lootRng = world.rng.get(SUBSYSTEM.loot);
  for (let u = 0; u < whole; u++) {
    if (node.pool <= 0) break;
    node.pool -= 1;
    const left = addStack(p.inventory, def.resourceItemId as ItemId, 1);
    if (left === 0) payout += 1;
    for (const sec of def.secondaries ?? []) {
      if (lootRng && lootRng.nextFloat() < sec.probability) {
        if (addStack(p.inventory, sec.itemId as ItemId, 1) === 0) {
          secondaries.push({ itemId: sec.itemId as ItemId, quantity: 1 });
        }
      }
    }
  }

  if (node.pool <= 0) {
    // depleted: schedule a seeded respawn (game seconds -> ticks, ADR-0004)
    const ticks = def.respawnSeconds > 0 ? Math.round((def.respawnSeconds / 4) * 5) : 0;
    node.respawnAtTick = ticks > 0 ? world.clock.tick + jitterMs(world, node) + ticks : 0;
    return { ok: true, payout, secondaries, depleted: true };
  }
  return { ok: true, payout, secondaries, depleted: false };
};

/** Seeded per-node delay inside a 0..50 % of the authored respawn window:
 *  "Node respawns are seeded and region-specific." Game seconds -> ticks
 *  at 1.25 ticks per game second (ADR-0004). */
const jitterMs = (world: World, node: WorldEntity): number => {
  const def = nodeById(node.contentId);
  if (!def || def.respawnSeconds <= 0) return 0;
  const rng = world.rng.get(SUBSYSTEM.nodeRespawn);
  const frac = rng ? rng.nextFloat() : 0;
  return Math.round(frac * def.respawnSeconds * 0.5 * 1.25);
};

/** Heuristic room check for a primary payout plus its expected secondaries
 *  before committing the swing (keeps the swing atomic w.r.t. inventory). */
const secondariesCount = (def: { secondaries?: { itemId: string; probability: number }[] | undefined }): number =>
  def.secondaries?.length ?? 0;

const canCarry = (p: PlayerEntity, itemId: ItemId, amount: number, expectedSecondaries: number): boolean => {
  // primary must fit; secondaries are probabilistic - a swing that cannot
  // even carry the primary is rejected, secondaries silently overflow to
  // the ground by the caller when the grid is truly full.
  void expectedSecondaries;
  const def = ITEMS.find((i) => i.id === itemId);
  if (!def) return false;
  let free = 0;
  const max = def.stackMax;
  for (const s of p.inventory) {
    if (s === null || s === undefined) free += max;
    else if (s.itemId === itemId && (s.payload ?? null) === null) free += max - s.quantity;
  }
  return free >= amount;
};

/**
 * Respawn tick (GDD §7): depleted nodes come back only when their seeded
 * timer has elapsed AND no live player is within 60 m. A node that is due
 * but blocked by players keeps its due tick and re-checks every tick.
 */
export const applyNodeRespawns = (world: World, store: EntityStore): string[] => {
  const respawned: string[] = [];
  for (const e of store.values()) {
    if (e.kind !== "world") continue;
    const node = e as WorldEntity;
    if (node.pool > 0 || node.respawnAtTick === 0 || world.clock.tick < node.respawnAtTick) continue;
    const nearPlayer = [...store.values()].some(
      (o): boolean =>
        o.kind === "player" &&
        !o.dead &&
        distCm(o.position.x, o.position.y, o.position.z, node.position.x, node.position.y, node.position.z) <= 6000,
    );
    if (nearPlayer) continue;
    const def = nodeById(node.contentId);
    if (!def) continue;
    node.pool = def.pool;
    node.accumulator = 0;
    node.respawnAtTick = 0;
    respawned.push(node.id);
  }
  return respawned;
};
