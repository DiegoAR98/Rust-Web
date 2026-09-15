/**
 * M4: structure attack, storage, rest, decay.
 */
import { describe, it, expect } from "vitest";
import { ITEMS } from "@dustfall/content";
import {
  EntityStore,
  newPlayer,
  createWorld,
  type PlayerEntity,
  type StructureEntity,
} from "@dustfall/sim";
import {
  attackStructure,
  depositToStructure,
  withdrawFromStructure,
  restAtStructure,
  applyStructureDecay,
} from "../src/structures.js";

const testWorld = () => createWorld("test", 0x12345678, 0xabcdef00);

const mk = (playerId: string, items: Array<{ itemId: string; quantity: number }>): { world: ReturnType<typeof testWorld>; store: EntityStore; p: PlayerEntity } => {
  const world = testWorld();
  const store = new EntityStore();
  const id = store.allocate();
  const p = newPlayer(id, playerId as never, { x: 0, y: 0, z: 0 });
  let slot = 0;
  for (const it of items) p.inventory[slot++] = { itemId: it.itemId as never, quantity: it.quantity };
  store.insert(p);
  return { world, store, p };
};

/** Insert a structure at (x, z) owned by ownerId. */
const mkStructure = (store: EntityStore, contentId: string, ownerId: string, x = 0, z = 100, hpOverride?: number): StructureEntity => {
  const def = ITEMS.find((i) => i.id === contentId);
  const maxHp = def?.building?.maxHp ?? 100;
  const st: StructureEntity = {
    id: store.allocate(),
    kind: "structure",
    contentId,
    position: { x, y: 0, z },
    ownerId,
    craft: null,
    hp: hpOverride ?? maxHp,
    maxHp,
    storage: Array.from({ length: def?.building?.storageSlots ?? 0 }, () => null),
    lastMaintainedAtTick: 0,
  };
  store.insert(st);
  return st;
};

describe("M4 structure attack (breach)", () => {
  it("hatchet swing deals multiplier*25 damage to a melee-breached wall", () => {
    const { world, store, p } = mk("p_a", [
      { itemId: "hatchet", quantity: 1 },
    ]);
    const wall = mkStructure(store, "wood_wall", "p_a", 0, 100); // 1m ahead: in 3m reach
    p.heldItemId = "hatchet";
    const hp0 = wall.hp;
    const r = attackStructure(world, store, p, wall.id);
    expect(r.ok).toBe(true);
    // hatchet toolMultiplier 2.0 x 25 = 50
    expect(r.damage).toBe(50);
    expect(wall.hp).toBe(hp0 - 50);
  });

  it("rock (multiplier 0.5) deals rounded 13 damage", () => {
    const { world, store, p } = mk("p_rock", [
      { itemId: "rock", quantity: 1 },
    ]);
    const wall = mkStructure(store, "wood_wall", "p_rock", 0, 100);
    p.heldItemId = "rock";
    const r = attackStructure(world, store, p, wall.id);
    expect(r.ok).toBe(true);
    expect(r.damage).toBe(13); // round(0.5 * 25) — must stay integral
    expect(Number.isInteger(wall.hp)).toBe(true);
  });

  it("reaches the cooldown after a valid swing", () => {
    const { world, store, p } = mk("p_c", [
      { itemId: "hatchet", quantity: 1 },
    ]);
    const wall = mkStructure(store, "wood_wall", "p_c", 0, 100);
    p.heldItemId = "hatchet";
    attackStructure(world, store, p, wall.id);
    const r2 = attackStructure(world, store, p, wall.id);
    expect(r2.ok).toBe(false);
    expect(r2.reason).toBe("cooldown");
  });

  it("rejects out-of-reach targets", () => {
    const { world, store, p } = mk("p_b", [
      { itemId: "hatchet", quantity: 1 },
    ]);
    const wall = mkStructure(store, "wood_wall", "p_b", 500, 100); // 5m away
    p.heldItemId = "hatchet";
    const r = attackStructure(world, store, p, wall.id);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("out_of_reach");
  });

  it("rejects explosive_only pieces (furnace) to melee", () => {
    const { world, store, p } = mk("p_e", [
      { itemId: "hatchet", quantity: 1 },
    ]);
    const furnace = mkStructure(store, "furnace", "p_e", 0, 100);
    p.heldItemId = "hatchet";
    const hp0 = furnace.hp;
    const r = attackStructure(world, store, p, furnace.id);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("not_melee_breached");
    expect(furnace.hp).toBe(hp0); // no damage
  });

  it("rejects when no tool is held", () => {
    const { world, store, p } = mk("p_n", [
      { itemId: "cloth", quantity: 1 },
    ]);
    const wall = mkStructure(store, "wood_wall", "p_n", 0, 100);
    // no heldItemId
    const r = attackStructure(world, store, p, wall.id);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("no_tool");
  });

  it("destroys a structure at 0 hp, dropping storage + the piece itself", () => {
    const { world, store, p } = mk("p_d", [
      { itemId: "hatchet", quantity: 1 },
    ]);
    // fragile shelter, nearly destroyed
    const shelter = mkStructure(store, "wood_shelter", "p_d", 0, 100, 10);
    p.heldItemId = "hatchet";
    const r = attackStructure(world, store, p, shelter.id);
    expect(r.ok).toBe(true);
    expect(r.destroyed).toBe(true);
    expect(store.get(shelter.id)).toBeUndefined();
    // a ground item (the shelter body) spawned at its position
    const ground = [...store.values()].filter((e) => e.kind === "ground_item");
    expect(ground.length).toBeGreaterThanOrEqual(1);
    expect(ground.some((g) => (g as { stack?: { itemId?: string } }).stack?.itemId === "wood_shelter")).toBe(true);
  });
});

describe("M4 storage", () => {
  it("deposits an inventory stack into a storage box", () => {
    const { store, p } = mk("p_s", [
      { itemId: "wood", quantity: 5 },
    ]);
    const box = mkStructure(store, "wood_storage_box", "p_s", 0, 100);
    const r = depositToStructure({} as never, store, p, box.id, 0, 0);
    expect(r.ok).toBe(true);
    expect(box.storage[0]?.itemId).toBe("wood");
    expect(box.storage[0]?.quantity).toBe(5);
    expect(p.inventory[0]).toBeNull();
  });

  it("withdraws from a storage box back to the inventory", () => {
    const { store, p } = mk("p_s2", []);
    const box = mkStructure(store, "wood_storage_box", "p_s2", 0, 100);
    box.storage[0] = { itemId: "wood", quantity: 5 };
    const r = withdrawFromStructure({} as never, store, p, box.id, 0, 0);
    expect(r.ok).toBe(true);
    expect(p.inventory[0]?.itemId).toBe("wood");
    expect(p.inventory[0]?.quantity).toBe(5);
    expect(box.storage[0]).toBeNull();
  });

  it("rejects deposit to a non-storage structure", () => {
    const { store, p } = mk("p_s3", [
      { itemId: "wood", quantity: 5 },
    ]);
    const wall = mkStructure(store, "wood_wall", "p_s3", 0, 100);
    const r = depositToStructure({} as never, store, p, wall.id, 0, 0);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("not_storage");
  });

  it("rejects deposit when out of reach", () => {
    const { store, p } = mk("p_s4", [
      { itemId: "wood", quantity: 5 },
    ]);
    const box = mkStructure(store, "wood_storage_box", "p_s4", 800, 100); // 8m
    const r = depositToStructure({} as never, store, p, box.id, 0, 0);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("out_of_reach");
  });

  it("merges stacks of the same item into one slot", () => {
    const { store, p } = mk("p_s5", [
      { itemId: "wood", quantity: 3 },
    ]);
    const box = mkStructure(store, "wood_storage_box", "p_s5", 0, 100);
    box.storage[0] = { itemId: "wood", quantity: 4 };
    const r = depositToStructure({} as never, store, p, box.id, 0, 0);
    expect(r.ok).toBe(true);
    expect(box.storage[0]?.quantity).toBe(7);
    expect(p.inventory[0]).toBeNull();
  });
});

describe("M4 rest (sleeping bag)", () => {
  it("rests at a sleeping bag, restoring 1 hp", () => {
    const { store, p } = mk("p_r", []);
    p.vitals.health = 90;
    const bag = mkStructure(store, "sleeping_bag", "p_r", 0, 100);
    const r = restAtStructure({} as never, store, p, bag.id);
    expect(r.ok).toBe(true);
    expect(p.vitals.health).toBe(91);
  });

  it("rejects rest at a non-restable structure", () => {
    const { store, p } = mk("p_r2", []);
    p.vitals.health = 90;
    const wall = mkStructure(store, "wood_wall", "p_r2", 0, 100);
    const r = restAtStructure({} as never, store, p, wall.id);
    expect(r.ok).toBe(false);
    expect(p.vitals.health).toBe(90);
  });
});

describe("M4 decay", () => {
  it("decays an unattended structure past its timer, refreshing owner proximity", () => {
    const { world, store, p } = mk("p_decay", []);
    // shelter: decayDays 3 => step = 3*108000/10 = 32400 ticks
    const shelter = mkStructure(store, "wood_shelter", "p_decay", 0, 100);
    const stepTicks = 32400;
    // owner far away (200m) so no refresh
    p.position = { x: 20000, y: 0, z: 0 };
    world.clock.tick = 1000;
    shelter.lastMaintainedAtTick = 0;
    // not yet due
    expect(applyStructureDecay(world, store)).toHaveLength(0);
    // advance past one step
    world.clock.tick = stepTicks + 1;
    const destroyed = applyStructureDecay(world, store);
    expect(destroyed).toHaveLength(0);
    expect(shelter.hp).toBeLessThan(shelter.maxHp);
  });

  it("does not decay when the owner is in refresh range", () => {
    const { world, store, p } = mk("p_decay2", []);
    const shelter = mkStructure(store, "wood_shelter", "p_decay2", 0, 100);
    // owner right next to it (1m away: within decay.owner_refresh_m)
    p.position = { x: 0, y: 0, z: 100 };
    world.clock.tick = 100000;
    shelter.lastMaintainedAtTick = 0;
    const destroyed = applyStructureDecay(world, store);
    expect(destroyed).toHaveLength(0);
    expect(shelter.hp).toBe(shelter.maxHp);
  });
});
