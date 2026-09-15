import { describe, expect, it } from "vitest";
import { EntityStore, commitDeath, respawnPlayer, createWorld, newPlayer, runTick } from "@dustfall/sim";
import type { PlayerEntity } from "@dustfall/sim";
import type { ItemId, PlayerId } from "@dustfall/contracts";

const testWorld = () => createWorld("test", 0x12345678, 0xabcdef00);

const mkPlayer = (store: EntityStore, playerId: string): PlayerEntity => {
  const id = store.allocate();
  const p = newPlayer(id, playerId as PlayerId, { x: 0, y: 0, z: 0 });
  store.insert(p);
  return p;
};

describe("death transaction (T07: drops every carried/equipped item once and only once)", () => {
  it("transfers the whole grid, equipment and held item into exactly one corpse", () => {
    const world = testWorld();
    const store = new EntityStore();
    const p = mkPlayer(store, "p_a");
    p.inventory[0] = { itemId: "wood" as ItemId, quantity: 30 };
    p.inventory[7] = { itemId: "stone" as ItemId, quantity: 12 };
    p.inventory[30] = { itemId: "cloth" as ItemId, quantity: 5 }; // hotbar
    p.equipment.helmet = { itemId: "cloth_helmet" as ItemId, quantity: 1 };
    p.equipment.vest = { itemId: "cloth_vest" as ItemId, quantity: 1 };
    p.inventory[2] = { itemId: "hatchet" as ItemId, quantity: 1 };
    p.heldItemId = "hatchet" as ItemId;
    p.dead = true;

    const tx = commitDeath(world, store, p);
    expect(tx).not.toBeNull();
    const t = tx!;

    // 6 stacks moved, in stable order (grid 0..35, then helmet, vest)
    expect(t.transferred).toHaveLength(6);
    expect(t.transferred.map((x) => x.slot)).toEqual([0, 2, 7, 30, 36, 37]);

    // exactly one corpse exists
    const corpses = [...store.values()].filter((e) => e.kind === "corpse");
    expect(corpses).toHaveLength(1);
    expect(corpses[0]!.id).toBe(t.corpseEntityId);

    // player is empty
    expect(p.inventory.every((s) => s === null)).toBe(true);
    expect(Object.keys(p.equipment)).toHaveLength(0);
    expect(p.heldItemId).toBeNull();

    // no duplication: total units match
    const total = t.transferred.reduce((n, x) => n + x.stack.quantity, 0);
    const corpse = corpses[0] as import("@dustfall/sim").CorpseEntity;
    const corpseTotal = corpse.inventory.reduce((n, s) => n + (s?.quantity ?? 0), 0);
    expect(total).toBe(50); // 30 wood + 1 hatchet + 12 stone + 5 cloth + 1 + 1 armor
    expect(corpseTotal).toBe(total);
  });

  it("commitDeath is idempotent: exactly one corpse even on repeated calls", () => {
    const world = testWorld();
    const store = new EntityStore();
    const p = mkPlayer(store, "p_a");
    p.inventory[0] = { itemId: "wood" as ItemId, quantity: 10 };
    p.dead = true;
    const t1 = commitDeath(world, store, p);
    const t2 = commitDeath(world, store, p);
    expect(t2?.corpseEntityId).toBe(t1?.corpseEntityId);
    const corpses = [...store.values()].filter((e) => e.kind === "corpse");
    expect(corpses).toHaveLength(1);
    // nothing moved a second time
    expect(p.inventory.every((s) => s === null)).toBe(true);
  });

  it("commitDeath refuses a living player", () => {
    const world = testWorld();
    const store = new EntityStore();
    const p = mkPlayer(store, "p_a");
    expect(commitDeath(world, store, p)).toBeNull();
  });

  it("the death fires exactly when vitals hit zero via the survival system", () => {
    const world = testWorld();
    const store = new EntityStore();
    const p = mkPlayer(store, "p_a");
    p.vitals.health = 0.2;
    p.vitals.calories = 0;
    p.inventory[0] = { itemId: "wood" as ItemId, quantity: 3 };
    // 0.2 hp at 0.25 hp/s starvation + idle drain -> dead within 30 ticks
    for (let i = 0; i < 30 && !p.dead; i++) runTick(world, store, []);
    expect(p.dead).toBe(true);
    const tx = commitDeath(world, store, p);
    expect(tx).not.toBeNull();
    expect([...store.values()].filter((e) => e.kind === "corpse")).toHaveLength(1);
  });
});

describe("respawn (GDD 3: loss creates a new objective)", () => {
  it("respawns with the starter kit at the given spawn, corpse stays behind with its loot", () => {
    const world = testWorld();
    const store = new EntityStore();
    const p = mkPlayer(store, "p_a");
    p.position = { x: 5000, y: 0, z: 6000 };
    p.inventory[0] = { itemId: "wood" as ItemId, quantity: 10 };
    p.inventory[1] = { itemId: "cloth" as ItemId, quantity: 2 };
    p.dead = true;
    const tx = commitDeath(world, store, p)!;

    const spawn = { x: -15000, y: 0, z: 38000 };
    respawnPlayer(world, store, p, spawn);
    expect(p.dead).toBe(false);
    expect(p.position).toEqual(spawn);
    expect(p.vitals.health).toBe(100);
    // starter kit
    expect(p.inventory[0]?.itemId).toBe("rock");
    expect(p.inventory[1]?.itemId).toBe("torch");
    expect(p.inventory[2]?.quantity).toBe(2);
    // corpse still has the loot
    const corpse = store.get(tx.corpseEntityId as import("@dustfall/contracts").EntityId);
    expect(corpse?.kind).toBe("corpse");
    const c = corpse as import("@dustfall/sim").CorpseEntity;
    expect(c.inventory.reduce((n, s) => n + (s?.quantity ?? 0), 0)).toBe(12);
    expect(c.position).toEqual({ x: 5000, y: 0, z: 6000 });
  });

  it("a second death creates a second corpse; the first keeps its loot (T16-style)", () => {
    const world = testWorld();
    const store = new EntityStore();
    const p = mkPlayer(store, "p_a");
    p.inventory[0] = { itemId: "wood" as ItemId, quantity: 10 };
    p.dead = true;
    const tx1 = commitDeath(world, store, p)!;
    respawnPlayer(world, store, p, { x: 0, y: 0, z: 0 });
    p.inventory[1] = { itemId: "stone" as ItemId, quantity: 4 };
    p.dead = true;
    const tx2 = commitDeath(world, store, p)!;
    expect(tx2.corpseEntityId).not.toBe(tx1.corpseEntityId);
    const corpses = [...store.values()].filter((e) => e.kind === "corpse");
    expect(corpses).toHaveLength(2);
    const c1 = store.get(tx1.corpseEntityId as import("@dustfall/contracts").EntityId) as import("@dustfall/sim").CorpseEntity;
    const c2 = store.get(tx2.corpseEntityId as import("@dustfall/contracts").EntityId) as import("@dustfall/sim").CorpseEntity;
    expect(c1.inventory.reduce((n, s) => n + (s?.quantity ?? 0), 0)).toBe(10);
    // second death: the starter kit (4) plus the carried 4 stone
    expect(c2.inventory.reduce((n, s) => n + (s?.quantity ?? 0), 0)).toBe(9);
  });
});
