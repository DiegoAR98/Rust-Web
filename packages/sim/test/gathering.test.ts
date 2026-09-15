import { describe, expect, it } from "vitest";
import { EntityStore, placeWorldNodes, resolveSwing, applyNodeRespawns, createWorld, newPlayer, runTick } from "@dustfall/sim";
import type { WorldEntity, PlayerEntity } from "@dustfall/sim";
import type { ItemId, PlayerId } from "@dustfall/contracts";

const placeNode = (store: EntityStore, contentId: string, x: number, y: number, z: number, pool: number): WorldEntity => {
  const n: WorldEntity = {
    id: store.allocate(),
    kind: "world",
    contentId,
    position: { x, y, z },
    pool,
    accumulator: 0,
    respawnAtTick: 0,
  };
  store.insert(n);
  return n;
};

const mkPlayer = (store: EntityStore, playerId: string, x: number, z: number): PlayerEntity => {
  const id = store.allocate();
  const p = newPlayer(id, playerId as PlayerId, { x, y: 0, z });
  store.insert(p);
  return p;
};

const runTicks = (world: ReturnType<typeof createWorld>, store: EntityStore, n: number): void => {
  for (let i = 0; i < n; i++) runTick(world, store, []);
};

const testWorld = (): ReturnType<typeof createWorld> => createWorld("test", 0x12345678, 0xabcdef00);

describe("gathering (GDD 7)", () => {
  it("a swing within reach pays out whole units via the accumulator (half-rate tools pay every second swing)", () => {
    const world = testWorld();
    const store = new EntityStore();
    const p = mkPlayer(store, "p_a", 0, 0);
    p.heldItemId = "rock" as ItemId;
    p.inventory[0] = { itemId: "rock" as ItemId, quantity: 1 };
    const node = placeNode(store, "node_tree", 100, 0, 0, 8); // 1 m away, rock = 0.5 multiplier

    const r1 = resolveSwing(world, store, p, node.id);
    expect(r1.ok).toBe(true);
    expect(r1.payout).toBe(0); // 0.5 accumulated, no whole unit yet
    expect(node.accumulator).toBe(0.5);

    runTicks(world, store, 24); // wait out the swing cooldown
    const r2 = resolveSwing(world, store, p, node.id);
    expect(r2.ok).toBe(true);
    expect(r2.payout).toBe(1); // second swing completes the first whole unit
    expect(node.pool).toBe(7);
    const wood = p.inventory.find((s) => s?.itemId === "wood");
    expect(wood?.quantity).toBe(1);
  });

  it("reaches only 3 m (gather.swing_reach_m)", () => {
    const world = testWorld();
    const store = new EntityStore();
    const p = mkPlayer(store, "p_a", 0, 0);
    p.heldItemId = "rock" as ItemId;
    p.inventory[0] = { itemId: "rock" as ItemId, quantity: 1 };
    const node = placeNode(store, "node_tree", 301, 0, 0, 8); // 3.01 m
    const r = resolveSwing(world, store, p, node.id);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("out_of_reach");
    expect(node.accumulator).toBe(0);
  });

  it("tool preference: rock cannot gather ore (minToolMultiplier 1), pickaxe can", () => {
    const world = testWorld();
    const store = new EntityStore();
    const p = mkPlayer(store, "p_a", 0, 0);
    p.heldItemId = "rock" as ItemId;
    p.inventory[0] = { itemId: "rock" as ItemId, quantity: 1 };
    const node = placeNode(store, "node_metal_ore", 50, 0, 0, 4);
    expect(resolveSwing(world, store, p, node.id).reason).toBe("tool_too_weak");

    p.heldItemId = "pickaxe" as ItemId;
    p.inventory[1] = { itemId: "pickaxe" as ItemId, quantity: 1 };
    const r = resolveSwing(world, store, p, node.id);
    expect(r.ok).toBe(true);
    expect(r.payout).toBe(2); // multiplier 2 -> two whole units
    expect(node.pool).toBe(2);
  });

  it("a swing requires the held tool to actually be in the inventory", () => {
    const world = testWorld();
    const store = new EntityStore();
    const p = mkPlayer(store, "p_a", 0, 0);
    p.heldItemId = "pickaxe" as ItemId; // claimed, not carried
    const node = placeNode(store, "node_metal_ore", 50, 0, 0, 4);
    const r = resolveSwing(world, store, p, node.id);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("no_tool");
  });

  it("swing cooldown: 24 ticks between effective swings", () => {
    const world = testWorld();
    const store = new EntityStore();
    const p = mkPlayer(store, "p_a", 0, 0);
    p.heldItemId = "rock" as ItemId;
    p.inventory[0] = { itemId: "rock" as ItemId, quantity: 1 };
    const node = placeNode(store, "node_tree", 50, 0, 0, 8);
    expect(resolveSwing(world, store, p, node.id).ok).toBe(true);
    expect(resolveSwing(world, store, p, node.id).reason).toBe("cooldown");
    runTicks(world, store, 12);
    expect(resolveSwing(world, store, p, node.id).reason).toBe("cooldown");
    runTicks(world, store, 12);
    expect(resolveSwing(world, store, p, node.id).ok).toBe(true);
  });

  it("swings cost the tool's calories", () => {
    const world = testWorld();
    const store = new EntityStore();
    const p = mkPlayer(store, "p_a", 0, 0);
    p.heldItemId = "hatchet" as ItemId;
    p.inventory[0] = { itemId: "hatchet" as ItemId, quantity: 1 };
    p.vitals.calories = 500;
    const node = placeNode(store, "node_tree", 50, 0, 0, 8);
    resolveSwing(world, store, p, node.id);
    expect(p.vitals.calories).toBeLessThan(500);
  });

  it("depletion schedules a respawn and the node stops yielding", () => {
    const world = testWorld();
    const store = new EntityStore();
    const p = mkPlayer(store, "p_a", 0, 0);
    p.heldItemId = "pickaxe" as ItemId;
    p.inventory[0] = { itemId: "pickaxe" as ItemId, quantity: 1 };
    p.vitals.calories = 3000;
    const node = placeNode(store, "node_stone_rock", 50, 0, 0, 2);
    const r = resolveSwing(world, store, p, node.id);
    expect(r.ok).toBe(true);
    expect(r.payout).toBe(2); // multiplier 2 pays out the whole pool
    expect(r.depleted).toBe(true);
    expect(node.pool).toBe(0);
    expect(node.respawnAtTick).toBeGreaterThan(world.clock.tick);
    runTicks(world, store, 24); // wait out the cooldown so the next failure is the node state
    expect(resolveSwing(world, store, p, node.id).reason).toBe("depleted");
  });

  it("respawn: node does not return while a player is within 60 m, does when clear", () => {
    const world = testWorld();
    const store = new EntityStore();
    const node = placeNode(store, "node_tree", 50, 0, 0, 8);
    node.pool = 0;
    node.respawnAtTick = world.clock.tick + 5; // due soon

    mkPlayer(store, "p_near", 0, 0); // 0.5 m from the node
    runTicks(world, store, 6);
    expect(node.pool).toBe(0); // blocked by nearby player
    const respawned = applyNodeRespawns(world, store);
    expect(respawned).not.toContain(node.id);

    // remove the nearby player; node is now clear
    for (const e of store.values()) {
      if (e.kind === "player") store.remove(e.id);
    }
    const respawned2 = applyNodeRespawns(world, store);
    expect(respawned2).toContain(node.id);
    expect(node.pool).toBe(8);
    expect(node.respawnAtTick).toBe(0);
  });

  it("dead players cannot swing", () => {
    const world = testWorld();
    const store = new EntityStore();
    const p = mkPlayer(store, "p_a", 0, 0);
    p.heldItemId = "rock" as ItemId;
    p.inventory[0] = { itemId: "rock" as ItemId, quantity: 1 };
    p.dead = true;
    const node = placeNode(store, "node_tree", 50, 0, 0, 8);
    expect(resolveSwing(world, store, p, node.id).reason).toBe("dead");
  });
});

describe("seeded world node placement", () => {
  it("places the authored counts deterministically from the world seed", () => {
    const worldA = createWorld("w1", 0x1111, 0x2222);
    const storeA = new EntityStore();
    const worldB = createWorld("w1", 0x1111, 0x2222);
    const storeB = new EntityStore();
    const nA = placeWorldNodes(worldA, storeA);
    const nB = placeWorldNodes(worldB, storeB);
    expect(nA).toBe(nB);
    expect(nA).toBe(288); // sum of NODE_PLACEMENTS counts
    const a = [...storeA.values()];
    const b = [...storeB.values()];
    expect(a.length).toBe(b.length);
    for (let i = 0; i < a.length; i++) {
      const wa = a[i]! as WorldEntity;
      const wb = b[i]! as WorldEntity;
      expect(wa.position).toEqual(wb.position);
      expect(wa.contentId).toBe(wb.contentId);
    }
  });

  it("different seeds give different layouts", () => {
    const worldA = createWorld("w1", 0x1111, 0x2222);
    const storeA = new EntityStore();
    placeWorldNodes(worldA, storeA);
    const worldB = createWorld("w1", 0x1111, 0x3333);
    const storeB = new EntityStore();
    placeWorldNodes(worldB, storeB);
    const a = [...storeA.values()].map((e) => `${e.position.x},${e.position.z}`);
    const b = [...storeB.values()].map((e) => `${e.position.x},${e.position.z}`);
    expect(a.join("|")).not.toBe(b.join("|"));
  });

  it("positions are integer cm; spawn-near nodes land near the spawn beach", () => {
    const world = createWorld("w1", 0x1111, 0x2222);
    const store = new EntityStore();
    placeWorldNodes(world, store);
    for (const e of store.values()) {
      if (e.kind !== "world") continue;
      expect(Number.isInteger(e.position.x)).toBe(true);
      expect(Number.isInteger(e.position.y)).toBe(true);
      expect(Number.isInteger(e.position.z)).toBe(true);
    }
    // bootheel's 40 near-spawn trees are all within 220 m of its first
    // spawn point (-150, 0, 380) m = (-15000, 0, 38000) cm. Other trees
    // may also fall inside the disc (pinewatch scatter), so this is a
    // lower bound - determinism of the exact layout is covered above.
    let within = 0;
    for (const e of store.values()) {
      if (e.kind !== "world" || e.contentId !== "node_tree") continue;
      const dx = e.position.x + 15000;
      const dz = e.position.z - 38000;
      if (Math.hypot(dx, dz) <= 22000 + 1) within += 1;
    }
    expect(within).toBeGreaterThanOrEqual(40);
  });
});
