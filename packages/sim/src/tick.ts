/**
 * Fixed-tick simulation loop (GDD §21.5).
 * Tick order:
 *  1. drain and validate inbound commands
 *  2. session, spawn and respawn transitions
 *  3. player movement and posture
 *  4. interactions, gathering, inventory, crafting and building intents
 *  5. weapon fire, projectiles, fuses and hit resolution
 *  6. damage, death, corpse and destruction transitions
 *  7. survival, status effects, stations, node respawn, weather and decay
 *  8. AI perception/evidence, planning, movement and action intents
 *  9. process AI actions through the same authoritative handlers
 * 10. collect durable transactions, authoritative events and dirty components
 * 11. build per-client interest sets and replica batches
 * 12. advance tick exactly once
 *
 * M2 scope implemented: movement (3), gathering swings (4), death
 * transitions (6), survival + node respawn (7).
 *
 * Determinism rule (GDD §21.5): commands are applied in stable order —
 * sorted by PlayerId, then sequence. Within a tick, the LAST command of
 * a player is authoritative for movement (newest input wins, superseding
 * older queued frames per §21.7); earlier commands in the same tick are
 * consumed without re-applying movement.
 */
import { advanceClock } from "./world.js";
import { applyMovement, type MovementIntent } from "./movement.js";
import { applyVitals } from "./vitals-sys.js";
import { ITEMS } from "@dustfall/content";
import { resolveSwing, applyNodeRespawns, type SwingResult } from "./gathering.js";
import { commitDeath, type DeathTransaction } from "./death.js";
import { loot, dropToGround, applyGroundDespawn } from "./pickup.js";
import { moveSlot, equipFromSlot, unequipSlot, type MoveResult } from "./inventory.js";
import { startCraft, advanceCrafts, research as researchBp, placeStructure } from "./crafting.js";
import {
  attackStructure,
  depositToStructure,
  withdrawFromStructure,
  restAtStructure,
  applyStructureDecay,
} from "./structures.js";
import { applyRadiation } from "./radiation.js";
import { applyWeather, applyCold } from "./environment.js";
import { startChannel, advanceChannels, cancelChannel } from "./channels.js";
import { spawnWildlife, advanceWildlife, hitAnimal } from "./wildlife.js";
import type { EntityStore, PlayerEntity } from "./entities.js";
import type { World } from "./world.js";
import type { Vec3 } from "@dustfall/contracts";

export interface TickCommand {
  playerId: string;
  sequence: number;
  intent: MovementIntent;
  yawHundredths: number;
  pitchHundredths: number;
  /** M2 intents (all optional; a move command may carry one) */
  swing?: { targetEntityId: string };
  pickup?: { sourceEntityId: string };
  drop?: { slot: number };
  moveItem?: { from: number; to: number; equip?: "helmet" | "vest" | "pants" | "boots" };
  /** M3: begin a hand or station craft */
  craft?: { recipeId: string; structureEntityId?: string };
  /** M3: research a blueprint at the Workbench */
  research?: { structureEntityId: string; itemId: string };
  /** M3: place a structure from a grid slot */
  place?: { slot: number; position: Vec3 };
  /** M4: deposit an inventory stack into a storage structure slot */
  deposit?: { structureEntityId: string; fromSlot: number; toSlot: number };
  /** M4: withdraw a storage structure stack into the inventory */
  withdraw?: { structureEntityId: string; fromSlot: number; toSlot: number };
  /** M4: rest next to a sleeping bag (health regen; full sleep = M5) */
  rest?: { structureEntityId: string };
  /** M5: start a food / med channel from a grid slot */
  channel?: { slot: number; kind: "food" | "bandage" | "medkit" | "antirad" };
  heldItemId?: string | null;
}

export interface TickEvents {
  moved: { playerId: string; x: number; y: number; z: number }[];
  died: string[];
  /** gathering payouts this tick */
  gathered: Array<{
    playerId: string;
    nodeEntityId: string;
    payout: number;
    secondaries: { itemId: string; quantity: number }[];
    depleted: boolean;
  }>;
  /** durable death transactions committed this tick (Class A, GDD §21.9) */
  deaths: DeathTransaction[];
  /** node entities that respawned this tick */
  respawnedNodes: string[];
  /** ground stacks despawned this tick */
  despawnedGround: string[];
  /** inventory mutations applied this tick (move/drop/loot/equip) */
  inventory: Array<{
    playerId: string;
    kind: "move" | "drop" | "pickup" | "equip" | "unequip";
    ok: boolean;
    touched: number[];
    taken?: { itemId: string; quantity: number }[];
  }>;
  /** M3: crafts that completed this tick */
  crafted: Array<{
    playerId: string;
    recipeId: string;
    structureEntityId?: string;
    itemId: string;
    quantity: number;
    dropped: boolean;
  }>;
  /** M3: blueprints learned this tick */
  researched: Array<{ playerId: string; payload: string }>;
  /** M3: structures placed this tick */
  placed: Array<{ playerId: string; structureEntityId: string; contentId: string }>;
  /** M4: structure damage from tool swings */
  attacked: Array<{
    playerId: string;
    structureEntityId: string;
    damage: number;
    hpAfter: number;
    destroyed: boolean;
  }>;
  /** M4: structures destroyed this tick (breach OR decay) */
  destroyed: string[];
  /** M5: animals spawned this tick (ids) */
  animalsSpawned: string[];
  /** M5: animals despawned this tick (ids) */
  animalsDespawned: string[];
  /** M5: animal melee hits */
  animalHits: Array<{
    playerId: string;
    animalEntityId: string;
    damage: number;
    killed: boolean;
  }>;
  /** M5: channels that completed this tick */
  channels: Array<{
    playerId: string;
    kind: "food" | "bandage" | "medkit" | "antirad";
    itemId: string;
  }>;
}

/**
 * Run one simulation tick. Returns events for the replication layer.
 */
export const runTick = (world: World, store: EntityStore, commands: TickCommand[]): TickEvents => {
  // 1. sort by playerId, then sequence
  const sorted = [...commands].sort((a, b) => {
    if (a.playerId !== b.playerId) return a.playerId < b.playerId ? -1 : 1;
    return a.sequence - b.sequence;
  });

  const events: TickEvents = { moved: [], died: [], gathered: [], deaths: [], respawnedNodes: [], despawnedGround: [], inventory: [], crafted: [], researched: [], placed: [], attacked: [], destroyed: [], animalsSpawned: [], animalsDespawned: [], animalHits: [], channels: [] };

  // group by player; the last command is the authoritative movement frame
  const byPlayer = new Map<string, TickCommand[]>();
  for (const cmd of sorted) {
    const list = byPlayer.get(cmd.playerId);
    if (list) list.push(cmd);
    else byPlayer.set(cmd.playerId, [cmd]);
  }

  const players: PlayerEntity[] = [];
  for (const e of store.values()) if (e.kind === "player") players.push(e);

  for (const p of players) {
    if (p.dead) continue;
    const cmds = byPlayer.get(p.playerId);

    // 4. interactions / gathering / inventory: every queued command this
    //    tick (a client may queue multiple LMB presses or drags between frames)
    let last: TickCommand | undefined;
    for (const cmd of cmds ?? []) {
      last = cmd;
      if (cmd.swing) {
        // M5: firing a swing cancels an active channel (GDD §6)
        if (p.channel) {
          cancelChannel(p);
        }
        // M4: a swing may target a structure (breach) as well as a node
        const swingTarget = store.get(cmd.swing.targetEntityId as import("@dustfall/contracts").EntityId);
        if (swingTarget && swingTarget.kind === "structure") {
          const ar = attackStructure(world, store, p, cmd.swing.targetEntityId);
          if (ar.ok) {
            events.attacked.push({
              playerId: p.playerId,
              structureEntityId: cmd.swing.targetEntityId,
              damage: ar.damage,
              hpAfter: ar.hpAfter,
              destroyed: ar.destroyed,
            });
            if (ar.destroyed) events.destroyed.push(cmd.swing.targetEntityId);
          }
        } else if (swingTarget && swingTarget.kind === "animal") {
          // M5: melee a wild animal with the held tool
          const held = p.heldItemId ? p.inventory.find((s) => s !== null && s !== undefined && s.itemId === p.heldItemId) : undefined;
          const toolDef = held ? ITEMS.find((i) => i.id === held.itemId) : undefined;
          const mult = toolDef?.tool?.toolMultiplier ?? 0.5; // bare hands
          const hr = hitAnimal(world, store, p, cmd.swing.targetEntityId, mult);
          if (hr.ok) {
            events.animalHits.push({
              playerId: p.playerId,
              animalEntityId: cmd.swing.targetEntityId,
              damage: hr.damage,
              killed: hr.killed,
            });
          }
        } else {
          const r: SwingResult = resolveSwing(world, store, p, cmd.swing.targetEntityId);
          if (r.ok) {
            events.gathered.push({
              playerId: p.playerId,
              nodeEntityId: cmd.swing.targetEntityId,
              payout: r.payout,
              secondaries: r.secondaries.map((s) => ({ itemId: s.itemId, quantity: s.quantity })),
              depleted: r.depleted,
            });
          }
        }
      }
      if (cmd.pickup) {
        const r = loot(world, store, p, cmd.pickup.sourceEntityId);
        events.inventory.push({
          playerId: p.playerId,
          kind: "pickup",
          ok: r.ok,
          touched: [],
          taken: r.taken.map((t) => ({ itemId: t.itemId, quantity: t.quantity })),
        });
      }
      if (cmd.drop) {
        const r = dropToGround(world, store, p, cmd.drop.slot);
        events.inventory.push({
          playerId: p.playerId,
          kind: "drop",
          ok: r.ok,
          touched: [cmd.drop.slot],
        });
      }
      if (cmd.moveItem) {
        let mr: MoveResult;
        if (cmd.moveItem.to === -1 && cmd.moveItem.equip) {
          // -1 target with a slot = unequip back to the grid
          mr = unequipSlot(p.inventory, p.equipment, cmd.moveItem.equip);
        } else if (cmd.moveItem.equip) {
          mr = equipFromSlot(p.inventory, p.equipment, cmd.moveItem.equip, cmd.moveItem.from);
        } else {
          mr = moveSlot(p.inventory, cmd.moveItem.from, cmd.moveItem.to);
        }
        events.inventory.push({
          playerId: p.playerId,
          kind: cmd.moveItem.to === -1 ? "unequip" : cmd.moveItem.equip ? "equip" : "move",
          ok: mr.ok,
          touched: mr.touched,
        });
      }
      if (cmd.craft) {
        const r = startCraft(world, store, p, cmd.craft.recipeId, cmd.craft.structureEntityId);
        if (!r.ok) {
          // surface the rejection to the replication layer so the UI can
          // show why the craft did not start
          void r.reason;
        }
      }
      if (cmd.research) {
        const r = researchBp(world, store, p, cmd.research.structureEntityId, cmd.research.itemId);
        if (r.ok && r.payload) events.researched.push({ playerId: p.playerId, payload: r.payload });
      }
      if (cmd.place) {
        const r = placeStructure(world, store, p, cmd.place.slot, cmd.place.position);
        if (!r.ok && process.env.DUSTFALL_DEBUG) {
          console.error(`[place:reject] ${p.playerId} slot=${cmd.place.slot} @(${cmd.place.position.x},${cmd.place.position.z}): ${r.reason}`);
        }
        if (r.ok && r.structureEntityId) {
          const st = store.get(r.structureEntityId);
          if (st && st.kind === "structure") events.placed.push({ playerId: p.playerId, structureEntityId: st.id, contentId: st.contentId });
        }
      }
      if (cmd.deposit) {
        const r = depositToStructure(world, store, p, cmd.deposit.structureEntityId, cmd.deposit.fromSlot, cmd.deposit.toSlot);
        events.inventory.push({
          playerId: p.playerId,
          kind: "move",
          ok: r.ok,
          touched: r.ok ? [cmd.deposit.fromSlot] : [],
        });
      }
      if (cmd.withdraw) {
        const r = withdrawFromStructure(world, store, p, cmd.withdraw.structureEntityId, cmd.withdraw.fromSlot, cmd.withdraw.toSlot);
        events.inventory.push({
          playerId: p.playerId,
          kind: "move",
          ok: r.ok,
          touched: r.ok ? [cmd.withdraw.toSlot] : [],
        });
      }
      if (cmd.rest) {
        restAtStructure(world, store, p, cmd.rest.structureEntityId);
      }
      if (cmd.channel) {
        const cr = startChannel(world, store, p, cmd.channel.slot, cmd.channel.kind);
        if (!cr.ok && process.env.DUSTFALL_DEBUG) {
          console.error(`[channel:reject] ${p.playerId} slot=${cmd.channel.slot} kind=${cmd.channel.kind}: ${cr.reason}`);
        }
      }
    }
    if (last?.heldItemId !== undefined) p.heldItemId = (last.heldItemId ?? null) as PlayerEntity["heldItemId"];

    // 3. movement from the newest frame only
    if (last) {
      const moving = Math.abs(last.intent.wishX) > 1 || Math.abs(last.intent.wishZ) > 1;
      applyMovement(p, last.intent);
      p.yawHundredths = last.yawHundredths;
      p.pitchHundredths = last.pitchHundredths;
      events.moved.push({ playerId: p.playerId, x: p.position.x, y: p.position.y, z: p.position.z });
      void moving;
    }

    // 7. survival: every live player, whether or not they sent input
    const moving = Math.abs(p.position.x - p.prevPosition.x) > 0 || Math.abs(p.position.z - p.prevPosition.z) > 0;
    const sprinting = byPlayer.get(p.playerId)?.at(-1)?.intent.sprint === true && moving;
    if (sprinting && p.channel) cancelChannel(p); // sprinting cancels (GDD §6)
    applyVitals(p, moving, sprinting);
    p.prevPosition = { ...p.position };

    // 6. death transitions: health hit zero this tick
    if (p.dead) {
      const tx = commitDeath(world, store, p);
      if (tx) events.deaths.push(tx);
      events.died.push(p.playerId);
    }
  }

  // 7. node respawn (GDD §7: never within 60 m of a live player)
  events.respawnedNodes.push(...applyNodeRespawns(world, store));
  // 7. ground stack despawn (GDD §8: catalog timer)
  events.despawnedGround.push(...applyGroundDespawn(world, store));

  // 7d. M5: advance food/med channels (may complete this tick)
  events.channels.push(...advanceChannels(world, store));

  // 12. advance tick exactly once
  advanceClock(world);

  // 7b. M3: advance hand + station crafts AFTER the clock advanced, so a
  //     craft with completesAtTick == oldTick+T completes on the T+1th tick
  //     observed (completesAtTick > startTick).
  events.crafted.push(...advanceCrafts(world, store));

  // 7c. M4: unattended structure decay (GDD §10). Runs after the clock so
  //     lastMaintainedAtTick < tick means "a full decay window elapsed".
  events.destroyed.push(...applyStructureDecay(world, store));

  // 7e. M5: radiation (position-based, GDD §15) + weather FSM + cold (§16)
  applyRadiation(world, store);
  applyWeather(world);
  applyCold(world, store);

  // 7f. M5: wildlife spawn + advance (GDD §12)
  events.animalsSpawned.push(...spawnWildlife(world, store));
  events.animalsDespawned.push(...advanceWildlife(world, store));

  return events;
};
