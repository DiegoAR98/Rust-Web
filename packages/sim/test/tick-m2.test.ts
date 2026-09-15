import { describe, expect, it } from "vitest";
import { EntityStore, createWorld, newPlayer, runTick } from "@dustfall/sim";
import type { PlayerEntity, WorldEntity, CorpseEntity } from "@dustfall/sim";
import type { ItemId, PlayerId } from "@dustfall/contracts";

const testWorld = () => createWorld("test", 0x12345678, 0xabcdef00);
const mkPlayer = (store: EntityStore, playerId: string, x = 0, z = 0): PlayerEntity => {
  const id = store.allocate();
  const p = newPlayer(id, playerId as PlayerId, { x, y: 0, z });
  store.insert(p);
  return p;
};
const move = (playerId: string, seq: number, extra?: Partial<import("@dustfall/sim").TickCommand>) => ({
  playerId,
  sequence: seq,
  intent: { wishX: 0, wishZ: 0, jump: false, crouch: false, sprint: false, inWater: false },
  yawHundredths: 0,
  pitchHundredths: 0,
  ...extra,
});

describe("M2 tick integration: gather -> move -> die -> loot", () => {
  it("gather via runTick emits gathered events; wood lands in the inventory", () => {
    const world = testWorld();
    const store = new EntityStore();
    const p = mkPlayer(store, "p_a", 0, 0);
    p.inventory[0] = { itemId: "pickaxe" as ItemId, quantity: 1 };
    p.heldItemId = "pickaxe" as ItemId;
    const node: WorldEntity = {
      id: store.allocate(),
      kind: "world",
      contentId: "node_stone_rock",
      position: { x: 50, y: 0, z: 0 },
      pool: 3,
      accumulator: 0,
      respawnAtTick: 0,
    };
    store.insert(node);

    const ev = runTick(world, store, [move("p_a", 1, { swing: { targetEntityId: node.id } })]);
    expect(ev.gathered).toHaveLength(1);
    expect(ev.gathered[0]!.payout).toBe(2);
    expect(ev.gathered[0]!.playerId).toBe("p_a");
    expect(store.get(node.id) as WorldEntity).toMatchObject({ pool: 1 });
    expect(p.inventory.find((s) => s?.itemId === "stone")?.quantity).toBe(2);
  });

  it("moveItem via runTick: server-authoritative, rejection mutates nothing", () => {
    const world = testWorld();
    const store = new EntityStore();
    const p = mkPlayer(store, "p_a", 0, 0);
    p.inventory[0] = { itemId: "wood" as ItemId, quantity: 30 };
    p.inventory[5] = { itemId: "wood" as ItemId, quantity: 90 };

    let ev = runTick(world, store, [move("p_a", 1, { moveItem: { from: 0, to: 5 } })]);
    expect(ev.inventory).toHaveLength(1);
    expect(ev.inventory[0]).toMatchObject({ ok: true, kind: "move" });
    // destination had 90 wood (max 100): partial merge, 20 stays in source
    expect(p.inventory[0]?.quantity).toBe(20);
    expect(p.inventory[5]?.quantity).toBe(100);

    // reject: grid completely full of wood -> stone cannot enter
    for (let i = 6; i < 36; i++) p.inventory[i] = { itemId: "wood" as ItemId, quantity: 100 };
    p.inventory[7] = { itemId: "stone" as ItemId, quantity: 10 };
    ev = runTick(world, store, [move("p_a", 2, { moveItem: { from: 7, to: 5 } })]);
    expect(ev.inventory[0]).toMatchObject({ ok: false });
    expect(p.inventory[5]?.quantity).toBe(100);
    expect(p.inventory[7]?.quantity).toBe(10);
  });

  it("idle death via starvation emits a death event with the full transfer (T07 at tick level)", () => {
    const world = testWorld();
    const store = new EntityStore();
    const p = mkPlayer(store, "p_a", 0, 0);
    p.vitals.health = 0.2;
    p.vitals.calories = 0;
    p.inventory[0] = { itemId: "wood" as ItemId, quantity: 7 };
    p.equipment.boots = { itemId: "cloth_boots" as ItemId, quantity: 1 };

    let ev;
    for (let i = 0; i < 30 && ev?.deaths.length !== 1; i++) {
      ev = runTick(world, store, []);
    }
    expect(ev?.deaths).toHaveLength(1);
    expect(ev?.died).toEqual(["p_a"]);
    const tx = ev!.deaths[0]!;
    expect(tx.playerId).toBe("p_a");
    // 7 wood + 1 boot
    expect(tx.transferred.reduce((n, t) => n + t.stack.quantity, 0)).toBe(8);
    const corpse = store.get(tx.corpseEntityId as import("@dustfall/contracts").EntityId) as CorpseEntity;
    expect(corpse.inventory.reduce((n, s) => n + (s?.quantity ?? 0), 0)).toBe(8);
    expect(p.inventory.every((s) => s === null)).toBe(true);
  });

  it("drop + loot round trip through runTick events", () => {
    const world = testWorld();
    const store = new EntityStore();
    const p = mkPlayer(store, "p_a", 0, 0);
    p.inventory[0] = { itemId: "cloth" as ItemId, quantity: 4 };

    let ev = runTick(world, store, [move("p_a", 1, { drop: { slot: 0 } })]);
    expect(ev.inventory[0]).toMatchObject({ ok: true, kind: "drop" });
    expect(p.inventory[0]).toBeNull();
    const gi = [...store.values()].find((e) => e.kind === "ground_item");
    expect(gi).toBeDefined();

    ev = runTick(world, store, [move("p_a", 2, { pickup: { sourceEntityId: gi!.id } })]);
    expect(ev.inventory[0]).toMatchObject({ ok: true, kind: "pickup" });
    expect(ev.inventory[0]!.taken).toEqual([{ itemId: "cloth", quantity: 4 }]);
    expect(p.inventory.find((s) => s?.itemId === "cloth")?.quantity).toBe(4);
    expect([...store.values()].filter((e) => e.kind === "ground_item")).toHaveLength(0);
  });

  it("a dead player cannot loot or move items (dead players send no gameplay)", () => {
    const world = testWorld();
    const store = new EntityStore();
    const p = mkPlayer(store, "p_a", 0, 0);
    p.dead = true;
    p.swingCooldownUntilTick = 0;
    const ev = runTick(world, store, [move("p_a", 1, { pickup: { sourceEntityId: "e_ffff" } })]);
    expect(ev.inventory).toHaveLength(0);
  });
});
