/**
 * M3 crafting tests (GDD §9): hand craft, station craft, research,
 * structure placement, death clears the in-progress craft.
 *
 * Real recipe ids from the launch spine (GDD Appendix B + M3 bow):
 *   recipe_bandage          hand      cloth x1        -> bandage, 60 ticks
 *   recipe_pickaxe          workbench wood+metal+stone-> pickaxe, 360, bp_pickaxe
 *   recipe_metal_fragments  furnace   metal_ore x1    -> metal_fragments, 180
 *   recipe_cooked_rabbit    campfire  raw rabbit meat -> cooked, 90
 */
import { describe, expect, it } from "vitest";
import { createWorld, newPlayer, EntityStore, startCraft, advanceCrafts, research, placeStructure, commitDeath, runTick } from "@dustfall/sim";
import type { PlayerEntity, StructureEntity } from "@dustfall/sim";
import { ITEMS } from "@dustfall/content";

const testWorld = () => createWorld("test", 0x12345678, 0xabcdef00);

const mk = (playerId: string, items: Array<{ itemId: string; quantity: number }>, blueprints: string[] = []): { world: ReturnType<typeof testWorld>; store: EntityStore; p: PlayerEntity } => {
  const world = testWorld();
  const store = new EntityStore();
  const id = store.allocate();
  const p = newPlayer(id, playerId as never, { x: 0, y: 0, z: 0 });
  p.blueprints = [...blueprints];
  let slot = 0;
  for (const it of items) p.inventory[slot++] = { itemId: it.itemId as never, quantity: it.quantity };
  store.insert(p);
  return { world, store, p };
};

const place = (store: EntityStore, contentId: string, ownerId: string, x = 0, z = 100): StructureEntity => {
  const def = ITEMS.find((i) => i.id === contentId);
  const hp = def?.building?.maxHp ?? 100;
  const st: StructureEntity = {
    id: store.allocate(),
    kind: "structure",
    contentId,
    position: { x, y: 0, z },
    ownerId,
    craft: null,
    hp,
    maxHp: hp,
    storage: Array.from({ length: def?.building?.storageSlots ?? 0 }, () => null),
    lastMaintainedAtTick: 0,
  };
  store.insert(st);
  return st;
};

describe("M3 hand craft", () => {
  it("crafts a bandage: deducts cloth, grants output on completion", () => {
    const { world, store, p } = mk("p_a", [{ itemId: "cloth", quantity: 3 }]);
    const r = startCraft(world, store, p, "recipe_bandage");
    expect(r.ok).toBe(true);
    // recipe pays 1 cloth of 3 → 2 remain
    expect(p.inventory[0]?.itemId).toBe("cloth");
    expect(p.inventory[0]?.quantity).toBe(2);

    const startTick = world.clock.tick; // startCraft set completesAt = tick + 60
    world.clock.tick = startTick + 59;
    expect(advanceCrafts(world, store)).toHaveLength(0);
    world.clock.tick = startTick + 60;
    const done = advanceCrafts(world, store);
    expect(done).toHaveLength(1);
    expect(done[0].itemId).toBe("bandage");
    expect(p.inventory.some((s) => s?.itemId === "bandage")).toBe(true);
  });

  it("rejects when unaffordable (atomic: nothing deducted)", () => {
    const { world, store, p } = mk("p_b", [{ itemId: "wood", quantity: 2 }]);
    const r = startCraft(world, store, p, "recipe_bandage");
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("cannot_afford");
    expect(p.inventory[0]?.quantity).toBe(2);
  });

  it("one queue: second craft rejected while the first runs", () => {
    const { world, store, p } = mk("p_c", [{ itemId: "cloth", quantity: 4 }]);
    expect(startCraft(world, store, p, "recipe_bandage").ok).toBe(true);
    const r2 = startCraft(world, store, p, "recipe_bandage");
    expect(r2.ok).toBe(false);
    expect(r2.reason).toBe("already_crafting");
  });

  it("requires the blueprint for gated recipes (bp_pickaxe)", () => {
    const noBp = mk("p_d", [{ itemId: "wood", quantity: 5 }, { itemId: "metal_fragments", quantity: 2 }, { itemId: "stone", quantity: 2 }]);
    const bench = place(noBp.store, "workbench", noBp.p.playerId, 0, 100);
    noBp.p.position = { x: 0, y: 0, z: 100 };
    expect(startCraft(noBp.world, noBp.store, noBp.p, "recipe_pickaxe", bench.id).reason).toBe("missing_blueprint");

    const withBp = mk("p_e", [{ itemId: "wood", quantity: 5 }, { itemId: "metal_fragments", quantity: 2 }, { itemId: "stone", quantity: 2 }], ["bp_pickaxe"]);
    const bench2 = place(withBp.store, "workbench", withBp.p.playerId, 0, 100);
    withBp.p.position = { x: 0, y: 0, z: 100 };
    expect(startCraft(withBp.world, withBp.store, withBp.p, "recipe_pickaxe", bench2.id).ok).toBe(true);
  });
});

describe("M3 station craft", () => {
  it("furnace: smelt 1 ore -> 1 metal fragment on the station queue", () => {
    const { world, store, p } = mk("p_f", [{ itemId: "metal_ore", quantity: 2 }]);
    const furnace = place(store, "furnace", p.playerId, 0, 100);
    p.position = { x: 0, y: 0, z: 90 }; // within craft.reach_m (3 m)

    const r = startCraft(world, store, p, "recipe_metal_fragments", furnace.id);
    expect(r.ok).toBe(true);
    expect(furnace.craft?.recipeId).toBe("recipe_metal_fragments");
    expect(furnace.craft?.startedBy).toBe(p.playerId);

    // wrong station is rejected
    const camp = place(store, "campfire", p.playerId, 0, -100);
    p.position = { x: 0, y: 0, z: -100 };
    expect(startCraft(world, store, p, "recipe_metal_fragments", camp.id).reason).toBe("wrong_structure");

    p.position = { x: 0, y: 0, z: 90 };
    const startTick = world.clock.tick;
    world.clock.tick = startTick + 180;
    const done = advanceCrafts(world, store);
    expect(done).toHaveLength(1);
    expect(done[0].structureEntityId).toBe(furnace.id);
    expect(done[0].itemId).toBe("metal_fragments");
    expect(p.inventory.some((s) => s?.itemId === "metal_fragments")).toBe(true);
  });

  it("campfire: cook raw rabbit meat -> cooked rabbit meat", () => {
    const { world, store, p } = mk("p_g", [{ itemId: "raw_rabbit_meat", quantity: 1 }]);
    const camp = place(store, "campfire", p.playerId, 0, 100);
    p.position = { x: 0, y: 0, z: 100 };
    expect(startCraft(world, store, p, "recipe_cooked_rabbit_meat", camp.id).ok).toBe(true);
    const startTick = world.clock.tick;
    world.clock.tick = startTick + 90;
    const done = advanceCrafts(world, store);
    expect(done[0].itemId).toBe("cooked_rabbit_meat");
    expect(p.inventory.some((s) => s?.itemId === "cooked_rabbit_meat")).toBe(true);
  });

  it("out-of-reach station craft is rejected", () => {
    const { world, store, p } = mk("p_h", [{ itemId: "metal_ore", quantity: 2 }]);
    const furnace = place(store, "furnace", p.playerId, 0, 1000);
    p.position = { x: 0, y: 0, z: 0 };
    const r = startCraft(world, store, p, "recipe_metal_fragments", furnace.id);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("out_of_reach");
    expect(furnace.craft).toBeNull();
  });

  it("drops the output at the station when the starter is gone", () => {
    const { world, store, p } = mk("p_i", [{ itemId: "metal_ore", quantity: 2 }]);
    const furnace = place(store, "furnace", p.playerId, 0, 100);
    p.position = { x: 0, y: 0, z: 100 };
    startCraft(world, store, p, "recipe_metal_fragments", furnace.id);
    store.remove(p.id); // starter leaves the world
    const startTick = world.clock.tick;
    world.clock.tick = startTick + 180;
    const done = advanceCrafts(world, store);
    expect(done[0].dropped).toBe(true);
    const gi = [...store.values()].find((e) => e.kind === "ground_item");
    expect(gi).toBeDefined();
    expect((gi as { stack: { itemId: string } }).stack.itemId).toBe("metal_fragments");
  });
});

describe("M3 research", () => {
  it("workbench + research kit + hatchet teaches bp_pickaxe once", () => {
    const { world, store, p } = mk("p_j", [{ itemId: "research_kit", quantity: 1 }, { itemId: "hatchet", quantity: 1 }]);
    const bench = place(store, "workbench", p.playerId, 0, 100);
    p.position = { x: 0, y: 0, z: 100 };
    const r = research(world, store, p, bench.id, "hatchet");
    expect(r.ok).toBe(true);
    expect(r.payload).toBe("bp_pickaxe");
    expect(p.blueprints).toContain("bp_pickaxe");
    p.inventory[0] = { itemId: "hatchet" as never, quantity: 1 };
    expect(research(world, store, p, bench.id, "hatchet").reason).toBe("already_known");
  });

  it("rejects non-researchable items and wrong structure", () => {
    const { world, store, p } = mk("p_k", [{ itemId: "research_kit", quantity: 2 }, { itemId: "wood", quantity: 5 }, { itemId: "hatchet", quantity: 1 }]);
    const bench = place(store, "workbench", p.playerId, 0, 100);
    p.position = { x: 0, y: 0, z: 100 };
    expect(research(world, store, p, bench.id, "wood").reason).toBe("not_researchable");
    const furnace = place(store, "furnace", p.playerId, 0, -100);
    p.position = { x: 0, y: 0, z: -100 };
    expect(research(world, store, p, furnace.id, "hatchet").reason).toBe("wrong_structure");
  });

  it("rejects without a research kit", () => {
    const { world, store, p } = mk("p_k2", [{ itemId: "hatchet", quantity: 1 }]);
    const bench = place(store, "workbench", p.playerId, 0, 100);
    p.position = { x: 0, y: 0, z: 100 };
    expect(research(world, store, p, bench.id, "hatchet").reason).toBe("cannot_afford");
  });
});

describe("M3 structure placement", () => {
  it("places a campfire from the grid, consuming the item", () => {
    const { world, store, p } = mk("p_l", [{ itemId: "campfire", quantity: 2 }]);
    const r = placeStructure(world, store, p, 0, { x: 0, y: 0, z: 150 });
    expect(r.ok).toBe(true);
    expect(p.inventory[0]?.quantity).toBe(1);
    const st = store.get(r.structureEntityId!);
    expect(st?.kind).toBe("structure");
    expect((st as StructureEntity).ownerId).toBe(p.playerId);
  });

  it("rejects out of reach / too close / per-player cap", () => {
    const { world, store, p } = mk("p_m", [{ itemId: "campfire", quantity: 12 }]);
    expect(placeStructure(world, store, p, 0, { x: 0, y: 0, z: 10000 }).reason).toBe("out_of_reach_place");
    const a = placeStructure(world, store, p, 0, { x: 0, y: 0, z: 150 });
    expect(a.ok).toBe(true);
    expect(placeStructure(world, store, p, 0, { x: 0, y: 0, z: 180 }).reason).toBe("too_close");
    // per-player cap (32): pre-insert 31 more structures owned by p, far away
    for (let i = 0; i < 31; i++) {
      store.insert({
        id: store.allocate(),
        kind: "structure",
        contentId: "furnace",
        position: { x: (i + 5) * 2000, y: 0, z: 40000 },
        ownerId: p.playerId,
        craft: null,
        hp: 100,
        maxHp: 100,
      } as StructureEntity);
    }
    expect(placeStructure(world, store, p, 0, { x: 0, y: 0, z: 300 }).reason).toBe("structure_cap");
  });

  it("non-building items cannot be placed; empty slot rejected", () => {
    const { world, store, p } = mk("p_n", [{ itemId: "wood", quantity: 8 }]);
    expect(placeStructure(world, store, p, 0, { x: 0, y: 0, z: 150 }).reason).toBe("not_a_structure");
    expect(placeStructure(world, store, p, 5, { x: 0, y: 0, z: 150 }).reason).toBe("empty_slot");
  });
});

describe("M3 death and crafting", () => {
  it("death clears the in-progress craft and does not refund", () => {
    const { world, store, p } = mk("p_o", [{ itemId: "metal_ore", quantity: 4 }]);
    const furnace = place(store, "furnace", p.playerId, 0, 100);
    p.position = { x: 0, y: 0, z: 100 };
    startCraft(world, store, p, "recipe_metal_fragments", furnace.id);
    p.inventory[0] = { itemId: "torch" as never, quantity: 1 }; // carried item
    p.vitals.health = 0;
    p.dead = true;
    const tx = commitDeath(world, store, p);
    expect(tx).not.toBeNull();
    expect(p.craft).toBeNull();
    expect(furnace.craft).toBeNull();
    const corpse = [...store.values()].find((e) => e.kind === "corpse");
    expect(corpse).toBeDefined();
    const stacks = (corpse as { inventory: Array<{ itemId: string } | null> }).inventory.filter(Boolean);
    expect(stacks.length).toBe(1);
    expect(stacks[0].itemId).toBe("torch"); // ore was consumed, not refunded
  });

  it("runTick dispatches craft intents and emits crafted events", () => {
    const { world, store, p } = mk("p_p", [{ itemId: "cloth", quantity: 1 }]);
    runTick(world, store, [{ playerId: p.playerId, sequence: 1, intent: { wishX: 0, wishZ: 0, sprint: false }, yawHundredths: 0, pitchHundredths: 0, craft: { recipeId: "recipe_bandage" } }]);
    expect(p.craft).not.toBeNull();
    let crafted: ReturnType<typeof runTick>["crafted"] = [];
    for (let i = 0; i < 70; i++) {
      const ev = runTick(world, store, []);
      if (ev.crafted.length === 1) {
        crafted = ev.crafted;
        break;
      }
    }
    expect(crafted.length).toBe(1);
    expect(crafted[0].itemId).toBe("bandage");
    expect(p.inventory.some((s) => s?.itemId === "bandage")).toBe(true);
  });
});
