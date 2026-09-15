import { describe, expect, it } from "vitest";
import {
  EntityStore,
  createWorld,
  newPlayer,
  dropToGround,
  loot,
  applyGroundDespawn,
  commitDeath,
  groundStackSize,
} from "@dustfall/sim";
import type { PlayerEntity, GroundItemEntity, CorpseEntity } from "@dustfall/sim";
import type { ItemId, PlayerId, BlueprintId } from "@dustfall/contracts";

const testWorld = () => createWorld("test", 0x12345678, 0xabcdef00);
const mkPlayer = (store: EntityStore, playerId: string, x = 0, z = 0): PlayerEntity => {
  const id = store.allocate();
  const p = newPlayer(id, playerId as PlayerId, { x, y: 0, z });
  store.insert(p);
  return p;
};

describe("ground drops and pickup (GDD 7/8)", () => {
  it("drop creates a ground stack at the player position; pickup takes it back", () => {
    const world = testWorld();
    const store = new EntityStore();
    const p = mkPlayer(store, "p_a", 0, 0);
    p.inventory[0] = { itemId: "wood" as ItemId, quantity: 12 };

    const d = dropToGround(world, store, p, 0);
    expect(d.ok).toBe(true);
    expect(p.inventory[0]).toBeNull();
    expect(groundStackSize(store)).toBe(1);
    const gi = [...store.values()].find((e) => e.kind === "ground_item") as GroundItemEntity;
    expect(gi.stack.quantity).toBe(12);
    expect(gi.position).toEqual({ x: 0, y: 0, z: 0 });
    expect(gi.despawnAtTick).toBeGreaterThan(0); // wood has a catalog despawn

    const r = loot(world, store, p, gi.id);
    expect(r.ok).toBe(true);
    expect(r.taken[0]?.quantity).toBe(12);
    expect(groundStackSize(store)).toBe(0);
  });

  it("pickups merge within 1.5 m with the same item/payload", () => {
    const world = testWorld();
    const store = new EntityStore();
    const p = mkPlayer(store, "p_a", 0, 0);
    p.inventory[0] = { itemId: "wood" as ItemId, quantity: 10 };
    dropToGround(world, store, p, 0);

    // drop a second wood stack 1 m away -> merges into the first
    p.inventory[0] = { itemId: "wood" as ItemId, quantity: 5 };
    const d2 = dropToGround(world, store, p, 0);
    expect(d2.ok).toBe(true);
    expect(groundStackSize(store)).toBe(1);
    const gi = [...store.values()].find((e) => e.kind === "ground_item") as GroundItemEntity;
    expect(gi.stack.quantity).toBe(15);

    // 2 m away: outside the merge radius -> new stack
    p.position = { x: 200, y: 0, z: 0 };
    p.inventory[0] = { itemId: "wood" as ItemId, quantity: 3 };
    dropToGround(world, store, p, 0);
    expect(groundStackSize(store)).toBe(2);
  });

  it("different payloads never merge (GDD 8)", () => {
    const world = testWorld();
    const store = new EntityStore();
    const p = mkPlayer(store, "p_a", 0, 0);
    p.inventory[0] = { itemId: "research_kit" as ItemId, quantity: 1, payload: "bp_a" as BlueprintId };
    dropToGround(world, store, p, 0);
    p.inventory[0] = { itemId: "research_kit" as ItemId, quantity: 1, payload: "bp_b" as BlueprintId };
    dropToGround(world, store, p, 0);
    expect(groundStackSize(store)).toBe(2);
  });

  it("picking up out of reach fails (server proves range)", () => {
    const world = testWorld();
    const store = new EntityStore();
    const p = mkPlayer(store, "p_a", 0, 0);
    p.inventory[0] = { itemId: "wood" as ItemId, quantity: 10 };
    const d = dropToGround(world, store, p, 0);
    expect(d.ok).toBe(true);
    // walk away 5 m
    p.position = { x: 500, y: 0, z: 0 };
    const r = loot(world, store, p, d.stack! ? ([...store.values()].find((e) => e.kind === "ground_item") as GroundItemEntity).id : "");
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("out_of_reach");
  });

  it("catalog despawn timer: a dropped resource disappears after its timer", () => {
    const world = testWorld();
    const store = new EntityStore();
    const p = mkPlayer(store, "p_a", 0, 0);
    p.inventory[0] = { itemId: "wood" as ItemId, quantity: 4 };
    dropToGround(world, store, p, 0);
    const gi = [...store.values()].find((e) => e.kind === "ground_item") as GroundItemEntity;
    // wood despawns after 600 game s = 750 ticks
    for (let i = 0; i < 749; i++) world.clock.tick += 1;
    expect(applyGroundDespawn(world, store)).toHaveLength(0);
    world.clock.tick += 1;
    expect(applyGroundDespawn(world, store)).toHaveLength(1);
    expect(groundStackSize(store)).toBe(0);
  });

  it("despawn 0 means never (starter tools)", () => {
    const world = testWorld();
    const store = new EntityStore();
    const p = mkPlayer(store, "p_a", 0, 0);
    p.inventory[0] = { itemId: "rock" as ItemId, quantity: 1 };
    dropToGround(world, store, p, 0);
    const gi = [...store.values()].find((e) => e.kind === "ground_item") as GroundItemEntity;
    expect(gi.despawnAtTick).toBe(0);
    for (let i = 0; i < 10_000; i++) world.clock.tick += 1;
    expect(applyGroundDespawn(world, store)).toHaveLength(0);
  });
});

describe("corpse loot (GDD 3/8)", () => {
  it("looting a corpse takes whole stacks in stable order and keeps it when full", () => {
    const world = testWorld();
    const store = new EntityStore();
    const p = mkPlayer(store, "p_a", 0, 0);
    p.inventory[0] = { itemId: "wood" as ItemId, quantity: 10 };
    p.inventory[1] = { itemId: "stone" as ItemId, quantity: 6 };
    p.dead = true;
    const tx = commitDeath(world, store, p)!;
    const corpse = store.get(tx.corpseEntityId as import("@dustfall/contracts").EntityId) as CorpseEntity;

    // a second player, 1 m away, with room for one stack only-ish (empty grid: takes all)
    const q = mkPlayer(store, "p_b", 50, 0);
    const r = loot(world, store, q, corpse.id);
    expect(r.ok).toBe(true);
    expect(r.taken).toHaveLength(2); // wood 10, stone 6
    expect(r.emptied).toBe(true);
    expect(store.get(corpse.id)).toBeUndefined(); // emptied corpse forgotten
    const wood = q.inventory.find((s) => s?.itemId === "wood");
    const stone = q.inventory.find((s) => s?.itemId === "stone");
    expect(wood?.quantity).toBe(10);
    expect(stone?.quantity).toBe(6);
  });

  it("looting a full grid takes nothing and changes nothing (atomic)", () => {
    const world = testWorld();
    const store = new EntityStore();
    const p = mkPlayer(store, "p_a", 0, 0);
    p.inventory[0] = { itemId: "wood" as ItemId, quantity: 5 };
    p.dead = true;
    const tx = commitDeath(world, store, p)!;
    const corpse = store.get(tx.corpseEntityId as import("@dustfall/contracts").EntityId) as CorpseEntity;

    // q's grid is completely full of wood
    const q = mkPlayer(store, "p_b", 50, 0);
    for (let i = 0; i < 36; i++) q.inventory[i] = { itemId: "wood" as ItemId, quantity: 100 };
    const before = JSON.stringify(corpse.inventory);
    const r = loot(world, store, q, corpse.id);
    // 1 wood stack of 5 can merge into the 100-wood grid (room = 0) -> nothing fits
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("no_room");
    expect(JSON.stringify(corpse.inventory)).toBe(before);
    expect(q.inventory[0]?.quantity).toBe(100);
  });
});
