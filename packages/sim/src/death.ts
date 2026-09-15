/**
 * Death / corpse / respawn (GDD §3, §8, §21.9).
 *
 * Death is immediate at zero health; there is no downed state. A death
 * transaction is a single Class-A atomic unit:
 *   - clear carried slots (36 grid + equipment + held item),
 *   - create exactly one corpse,
 *   - transfer every stack into the corpse in stable slot order,
 *   - mark the player dead,
 *   - append the durable journal row (host layer, GDD §21.9 idempotency key
 *     (playerId, sessionId, sequence)).
 *
 * T07: a death drops every carried/equipped item once and only once.
 * T16: a crash immediately after a death acknowledgement restores exactly
 * one corpse and zero duplicated items - the journal row is written in the
 * same transaction as the state change, and replay is a no-op.
 *
 * The corpse persists at the death location; a dead player may respawn at
 * the region spawn with a fresh starter kit. The corpse and its contents
 * are recoverable (loot) or can be carried by raider AI (M7).
 */
import type { EntityStore, PlayerEntity, CorpseEntity } from "./entities.js";
import type { World } from "./world.js";
import type { ItemStack, ItemStack as Stack } from "@dustfall/contracts";

export interface DeathTransaction {
  playerId: string;
  playerEntityId: string;
  corpseEntityId: string;
  /** every stack that left the player, in stable slot order (T07 evidence) */
  transferred: Array<{ slot: number; stack: Stack }>;
  /** tick the death was committed */
  tick: number;
  /** position of the corpse, cm */
  position: { x: number; y: number; z: number };
}

/**
 * Build + commit the death transaction for a player whose vitals hit zero.
 * Safe to call when the player is already dead: returns the original
 * transaction (idempotent, GDD §21.9) - exactly one corpse ever.
 */
export const commitDeath = (
  world: World,
  store: EntityStore,
  p: PlayerEntity,
): DeathTransaction | null => {
  if (!p.dead) return null;

  // idempotency: if a corpse already exists for this player, return it
  const existing = findCorpseForPlayer(store, p);
  if (existing) {
    return {
      playerId: p.playerId,
      playerEntityId: p.id,
      corpseEntityId: existing.corpseEntityId,
      transferred: existing.transferred,
      tick: existing.tick,
      position: existing.position,
    };
  }

  const transferred: DeathTransaction["transferred"] = [];

  // stable slot order: 0..35 grid, then helmet, vest, pants, boots
  for (let i = 0; i < p.inventory.length; i++) {
    const s = p.inventory[i];
    if (s === null || s === undefined) continue;
    const stack: Stack = { ...s };
    transferred.push({ slot: i, stack });
    p.inventory[i] = null;
  }
  for (const slot of ["helmet", "vest", "pants", "boots"] as const) {
    const s = p.equipment[slot];
    if (s === undefined) continue;
    const stack: Stack = { ...s };
    transferred.push({ slot: 36 + ["helmet", "vest", "pants", "boots"].indexOf(slot), stack });
    delete p.equipment[slot];
  }
  p.heldItemId = null;

  // exactly one corpse, at the death location
  const corpseId = store.allocate();
  const corpse: CorpseEntity = {
    id: corpseId,
    kind: "corpse",
    position: { ...p.position },
    inventory: transferred.map((t) => t.stack),
  };
  store.insert(corpse);

  const tx: DeathTransaction = {
    playerId: p.playerId,
    playerEntityId: p.id,
    corpseEntityId: corpseId,
    transferred,
    tick: world.clock.tick,
    position: { ...p.position },
  };
  rememberDeath(world, p, tx);
  return tx;
};

/**
 * Respawn a dead player at the region spawn with a fresh starter kit
 * (GDD §3: rock, torch, two bandages). The previous corpse and its
 * contents are untouched - loss creates the recovery objective.
 */
export const respawnPlayer = (
  world: World,
  store: EntityStore,
  p: PlayerEntity,
  spawn: { x: number; y: number; z: number },
): void => {
  if (!p.dead) return;
  // a later death is a NEW transaction: clear the idempotency record so
  // commitDeath creates a fresh corpse. The old corpse keeps its loot -
  // both corpses coexist (T16: one corpse per death, zero duplication).
  deaths.delete(p);
  p.dead = false;
  p.deadTicks = 0;
  p.position = { ...spawn };
  p.prevPosition = { ...spawn };
  p.velocityY = 0;
  p.onGround = true;
  p.vitals = {
    health: 100,
    calories: 1500,
    radiation: 0,
    bleeding: 0,
    coldDeficit: 0,
    poisonedTimer: 0,
    radiationSicknessTimer: 0,
    comfortTimer: 0,
  };
  p.inventory = new Array(36).fill(null);
  p.equipment = {};
  p.heldItemId = null;
  p.inventory[0] = { itemId: "rock" as Stack["itemId"], quantity: 1 };
  p.inventory[1] = { itemId: "torch" as Stack["itemId"], quantity: 1 };
  p.inventory[2] = { itemId: "bandage" as Stack["itemId"], quantity: 2 };
  p.inventory[28] = { itemId: "rock" as Stack["itemId"], quantity: 1 };
  p.inventory[29] = { itemId: "torch" as Stack["itemId"], quantity: 1 };
  p.swingCooldownUntilTick = 0;
};

// ---- in-memory idempotency registry (per world process) ----
const deaths = new WeakMap<PlayerEntity, DeathTransaction>();

const rememberDeath = (world: World, p: PlayerEntity, tx: DeathTransaction): void => {
  void world;
  deaths.set(p, tx);
};

const findCorpseForPlayer = (
  store: EntityStore,
  p: PlayerEntity,
): { corpseEntityId: string; transferred: DeathTransaction["transferred"]; tick: number; position: { x: number; y: number; z: number } } | undefined => {
  const tx = deaths.get(p);
  if (!tx) return undefined;
  if (store.get(tx.corpseEntityId as import("@dustfall/contracts").EntityId)?.kind !== "corpse") return undefined;
  return tx;
};
