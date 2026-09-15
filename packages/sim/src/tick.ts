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
import { resolveSwing, applyNodeRespawns, type SwingResult } from "./gathering.js";
import { commitDeath, type DeathTransaction } from "./death.js";
import { loot, dropToGround, applyGroundDespawn } from "./pickup.js";
import { moveSlot, equipFromSlot, unequipSlot, type MoveResult } from "./inventory.js";
import type { EntityStore, PlayerEntity } from "./entities.js";
import type { World } from "./world.js";

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

  const events: TickEvents = { moved: [], died: [], gathered: [], deaths: [], respawnedNodes: [], despawnedGround: [], inventory: [] };

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

  // 12. advance tick exactly once
  advanceClock(world);
  return events;
};
