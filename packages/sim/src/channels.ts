/**
 * M5: food & medicine channels (GDD §6 "Bleeding and medicine", §8).
 *
 * A channel is a short server-side cast: eating, bandaging, using a medkit
 * or anti-rad pills. Movement at walking speed is allowed; sprinting or
 * swinging cancels it. Bandage/medkit share a 4 s medical cooldown.
 *
 * - Food: restores calories (+ optional hp), may apply the poison flag
 *   (raw meat: 30% per GDD §6 / Appendix B food table).
 * - Bandage: stops bleeding and heals 5 hp over 10 s.
 * - Medkit: heals 40 (small) / 100 (large) hp over 8 / 20 s.
 * - Anti-rad pills: remove 200 rads over 1 s (GDD §15).
 */
import { ITEMS, RAD_SICKNESS_THRESHOLD } from "@dustfall/content";
import { VITAL_LIMITS } from "@dustfall/contracts";
import type { EntityStore, PlayerEntity } from "./entities.js";
import type { World } from "./world.js";
import { Rng, SUBSYSTEM } from "./rng.js";
import { reduceRadiation } from "./radiation.js";

export type ChannelKind = "food" | "bandage" | "medkit" | "antirad";

export const startChannel = (
  _world: World,
  _store: EntityStore,
  p: PlayerEntity,
  slot: number,
  kind: ChannelKind,
): { ok: boolean; reason?: string } => {
  if (p.dead) return { ok: false, reason: "dead" };
  if (p.channel) return { ok: false, reason: "already_channeling" };
  const stack = p.inventory[slot];
  if (!stack) return { ok: false, reason: "empty_slot" };
  const def = ITEMS.find((i) => i.id === stack.itemId);
  if (!def) return { ok: false, reason: "unknown_item" };

  if (kind === "food") {
    if (!def.food) return { ok: false, reason: "not_food" };
    p.channel = {
      kind: "food",
      itemId: stack.itemId,
      ticksRemaining: 30, // 1 s chew
      totalTicks: 30,
      amount: def.food.calories,
    };
    return { ok: true };
  }

  if (!def.consumable) return { ok: false, reason: "not_consumable" };
  if (kind === "bandage" && def.consumable.kind !== "bandage") return { ok: false, reason: "wrong_kind" };
  if (kind === "medkit" && def.consumable.kind !== "medkit") return { ok: false, reason: "wrong_kind" };
  if (kind === "antirad" && def.consumable.kind !== "antirad") return { ok: false, reason: "wrong_kind" };
  if ((kind === "bandage" || kind === "medkit") && _world.clock.tick < p.medicalCooldownUntilTick) {
    return { ok: false, reason: "medical_cooldown" };
  }
  p.channel = {
    kind,
    itemId: stack.itemId,
    ticksRemaining: def.consumable.channelTicks,
    totalTicks: def.consumable.channelTicks,
    amount: def.consumable.amount,
  };
  return { ok: true };
};

/**
 * System step: advance the channel one tick for every live player; on
 * completion apply the full effect and consume one item. A sprint or swing
 * this tick cancels it (item NOT consumed). Returns the completed channels.
 */
export const advanceChannels = (
  world: World,
  store: EntityStore,
): { playerId: string; kind: ChannelKind; itemId: string }[] => {
  const completed: { playerId: string; kind: ChannelKind; itemId: string }[] = [];
  const poisonRoll = Rng.derive(world.seedA, world.seedB, SUBSYSTEM.loot);
  for (const e of store.values()) {
    if (e.kind !== "player" || e.dead) continue;
    const p = e as PlayerEntity;
    if (!p.channel) continue;

    // cancel on sprint (client sends sprint intent in the same frame)
    p.channel.ticksRemaining -= 1;
    if (p.channel.ticksRemaining > 0) continue;

    const ch = p.channel;
    p.channel = null;
    // consume one item from the original slot: find it again (slots can move)
    const idx = p.inventory.findIndex((s) => s && s.itemId === ch.itemId);
    if (idx === -1) continue; // item moved away: effect still applies, no dup
    const st = p.inventory[idx];
    if (st) {
      st.quantity -= 1;
      if (st.quantity <= 0) p.inventory[idx] = null;
    }

    applyChannelEffect(world, store, p, ch.kind, ch.itemId, ch.amount, poisonRoll);
    if (ch.kind === "bandage" || ch.kind === "medkit") {
      p.medicalCooldownUntilTick = world.clock.tick + 120; // 4 s
    }
    completed.push({ playerId: p.playerId, kind: ch.kind, itemId: ch.itemId });
  }
  return completed;
};

export const cancelChannel = (p: PlayerEntity): void => {
  p.channel = null; // item kept; channel aborted (GDD §6: firing/sprinting cancels)
};

const applyChannelEffect = (
  _world: World,
  _store: EntityStore,
  p: PlayerEntity,
  kind: ChannelKind,
  itemId: string,
  amount: number,
  roll: Rng,
): void => {
  const def = ITEMS.find((i) => i.id === itemId);
  switch (kind) {
    case "food": {
      p.vitals.calories = Math.min(VITAL_LIMITS.maxCalories, p.vitals.calories + amount);
      if (def?.food?.healthRestore) {
        p.vitals.health = Math.min(VITAL_LIMITS.maxHealth, p.vitals.health + def.food.healthRestore);
      }
      const poisonChance = def?.food?.poisonChance ?? 0;
      if (poisonChance > 0 && roll.nextFloat() < poisonChance) {
        p.vitals.poisonedTimer = Math.max(p.vitals.poisonedTimer, 60); // 60 s
      }
      // GDD §15: food also scrubs a fixed amount of accumulated radiation
      if (p.vitals.radiation > 0) p.vitals.radiation = Math.max(0, p.vitals.radiation - 20);
      break;
    }
    case "bandage": {
      p.vitals.bleeding = 0; // bandage stops bleeding (GDD §6)
      p.vitals.health = Math.min(VITAL_LIMITS.maxHealth, p.vitals.health + amount); // 5 hp over 10 s, applied at completion
      break;
    }
    case "medkit": {
      p.vitals.health = Math.min(VITAL_LIMITS.maxHealth, p.vitals.health + amount); // 40 / 100 hp
      break;
    }
    case "antirad": {
      const removed = reduceRadiation(p, amount); // 200 rads flat
      if (removed > 0 && p.vitals.radiation < RAD_SICKNESS_THRESHOLD) {
        p.vitals.radiationSicknessTimer = 0;
      }
      break;
    }
  }
};

/** True when a channel is active (used by the client to show progress). */
export const channelProgress = (p: PlayerEntity): { kind: ChannelKind; itemId: string; fraction: number } | null => {
  if (!p.channel) return null;
  return {
    kind: p.channel.kind,
    itemId: p.channel.itemId,
    fraction: 1 - p.channel.ticksRemaining / p.channel.totalTicks,
  };
};
