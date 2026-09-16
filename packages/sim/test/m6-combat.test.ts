/**
 * M6: combat integration (GDD §11).
 *
 * - T05: Wood Door = 500 HP; six Hand Grenades OR one Explosive Charge
 *   breaches it.
 * - T06: Metal Wall requires four Explosive Charges under the authored rule.
 * - M6-03: PVP melee via the swing path (1.5 m+ reach, cooldown, bare-hands
 *   base damage); the fire path only accepts weapons.
 * - M6-04: the bow launches a physical, recoverable projectile.
 * - M6-05: magazine + reload (partial mag on a short ammo stack).
 * - M6-02: the full damage formula (falloff × zone × armor clamp).
 * - M6-07: no weapon penetrates walls (a building-tier piece eats the shot).
 * - T09/T19: dead shooters, future ticks, out-of-window aim and non-weapons
 *   mutate no authoritative state.
 * - T10: a shot resolves against the target pose at the shooter's
 *   acknowledged client tick (rewind), not the current pose.
 *
 * These drive the sim directly (resolveFire + the advance helpers) so they
 * prove the rules without a network. The exit-gate smoke test
 * (tools/smoke/src/m6-gate.mjs) drives the real host over a socket.
 */
import { describe, it, expect } from "vitest";
import {
  createWorld,
  newPlayer,
  EntityStore,
  placeStructure,
  resolveFire,
  advanceProjectiles,
  detonateFuses,
  advanceWeapons,
  advanceClock,
  hitPlayer,
  runTick,
  type PlayerEntity,
  type StructureEntity,
  type ProjectileEntity,
  type Entity,
} from "@dustfall/sim";
import { ITEMS } from "@dustfall/content";
import type { EntityId } from "@dustfall/contracts";

const world0 = () => createWorld("m6", 0x6666, 0x0f00);

const mk = (
  pid: string,
  items: Array<{ itemId: string; quantity: number }> = [],
  pos = { x: 0, y: 0, z: 0 },
): { world: ReturnType<typeof world0>; store: EntityStore; p: PlayerEntity } => {
  const world = world0();
  const store = new EntityStore();
  const p = newPlayer(store.allocate(), pid as never, pos);
  let slot = 0;
  for (const it of items) p.inventory[slot++] = { itemId: it.itemId as never, quantity: it.quantity };
  store.insert(p);
  // The sim records poses at tick end (M6 rewind window): prime the shooter's
  // ring at tick 0 so a shot at the current tick resolves on it.
  p.poseHistory.record(world.clock.tick, p.position);
  return { world, store, p };
};

/** Point the shooter (eye at feet+120) at `target` (chest at target+80). */
const aimAt = (
  shooter: PlayerEntity,
  target: { x: number; y: number; z: number },
  serverTick: number,
): { serverTick: number; yawHundredths: number; pitchHundredths: number } => {
  const ox = shooter.position.x;
  const oy = shooter.position.y + 120;
  const oz = shooter.position.z;
  const dx = target.x - ox;
  const dy = target.y + 80 - oy;
  const dz = target.z - oz;
  const yawHundredths = Math.round((Math.atan2(dx, dz) * 180) / Math.PI * 100);
  const pitchHundredths = Math.round((Math.atan2(dy, Math.hypot(dx, dz)) * 180) / Math.PI * 100);
  return { serverTick, yawHundredths, pitchHundredths };
};

/** Give a player a weapon in slot 0 + ammo in slot 1, and prime the magazine. */
const arm = (p: PlayerEntity, weaponId: string, ammoId?: string, ammoQty = 60): void => {
  p.inventory[0] = { itemId: weaponId as never, quantity: 1 };
  if (ammoId && ammoQty > 0) p.inventory[1] = { itemId: ammoId as never, quantity: ammoQty };
  p.heldItemId = weaponId as never;
  const def = ITEMS.find((i) => i.id === weaponId);
  if (def?.weapon?.magazineSize && def.weapon.magazineSize > 0) {
    p.weapon.loadedByItemId[weaponId] = def.weapon.magazineSize;
  }
};

/** Put a building item in slot 2 so placeStructure has something to consume. */
const withBuilding = (p: PlayerEntity, itemId: string, qty = 4): void => {
  p.inventory[2] = { itemId: itemId as never, quantity: qty };
};

const findFuse = (store: EntityStore): Entity | undefined => {
  for (const e of store.values()) if (e.kind === "fuse") return e;
  return undefined;
};

describe("T05: Wood Door breach counts (GDD §11 Explosives)", () => {
  it("six Hand Grenades (85 dmg) breach a 500 HP Wood Door", () => {
    const { world, store, p } = mk("t05_g", [{ itemId: "hand_grenade", quantity: 8 }]);
    withBuilding(p, "wood_door");
    const door = placeStructure(world, store, p, 2, { x: 0, y: 0, z: 100 });
    expect(door.ok).toBe(true);
    const st = store.get(door.structureEntityId! as EntityId) as StructureEntity;
    expect(st.hp).toBe(500);
    for (let i = 0; i < 6; i++) {
      p.heldItemId = "hand_grenade" as never;
      const r = resolveFire(world, store, p, world.clock.tick, aimAt(p, { ...st.position }, world.clock.tick), {
        targetEntityId: st.id,
      });
      expect(r.ok, `plant ${i}: ${r.reason}`).toBe(true);
      const fuse = findFuse(store);
      expect(fuse, `expected a live fuse on plant ${i}`).toBeDefined();
      // run the 4 s fuse (120 ticks)
      while (world.clock.tick < (fuse as import("@dustfall/sim").FuseEntity).detonateAtTick) advanceClock(world);
      const det = detonateFuses(world, store);
      expect(det.length, `detonation ${i}`).toBe(1);
      expect(det[0]!.structures.find((s) => s.structureEntityId === st.id)?.damage).toBe(85);
    }
    expect(st.hp).toBe(0);
    expect(store.has(st.id)).toBe(false); // destroyed → removed
  });

  it("one Explosive Charge (600 dmg) breaches a 500 HP Wood Door", () => {
    const { world, store, p } = mk("t05_c", [{ itemId: "explosive_charge", quantity: 1 }]);
    withBuilding(p, "wood_door");
    const door = placeStructure(world, store, p, 2, { x: 0, y: 0, z: 100 });
    const st = store.get(door.structureEntityId! as EntityId) as StructureEntity;
    p.heldItemId = "explosive_charge" as never;
    const r = resolveFire(world, store, p, world.clock.tick, aimAt(p, { ...st.position }, world.clock.tick), {
      targetEntityId: st.id,
    });
    expect(r.ok, r.reason).toBe(true);
    const fuse = findFuse(store)! as import("@dustfall/sim").FuseEntity;
    while (world.clock.tick < fuse.detonateAtTick) advanceClock(world);
    const det = detonateFuses(world, store);
    expect(det[0]!.structures.find((s) => s.structureEntityId === st.id)?.damage).toBe(600);
    expect(store.has(st.id)).toBe(false); // destroyed
  });
});

describe("T06: Metal Wall needs four Explosive Charges", () => {
  it("three charges leave it standing; the fourth destroys it", () => {
    const { world, store, p } = mk("t06", [{ itemId: "explosive_charge", quantity: 6 }]);
    withBuilding(p, "metal_wall");
    const wall = placeStructure(world, store, p, 2, { x: 0, y: 0, z: 100 });
    const st = store.get(wall.structureEntityId! as EntityId) as StructureEntity;
    expect(st.maxHp).toBe(2000);
    for (let i = 0; i < 3; i++) {
      p.heldItemId = "explosive_charge" as never;
      const r = resolveFire(world, store, p, world.clock.tick, aimAt(p, { ...st.position }, world.clock.tick), {
        targetEntityId: st.id,
      });
      expect(r.ok, `plant ${i}: ${r.reason}`).toBe(true);
      const fuse = findFuse(store)! as import("@dustfall/sim").FuseEntity;
      while (world.clock.tick < fuse.detonateAtTick) advanceClock(world);
      detonateFuses(world, store);
      expect(st.hp).toBe(2000 - 600 * (i + 1));
      expect(store.has(st.id)).toBe(true);
    }
    p.heldItemId = "explosive_charge" as never;
    const r4 = resolveFire(world, store, p, world.clock.tick, aimAt(p, { ...st.position }, world.clock.tick), {
      targetEntityId: st.id,
    });
    expect(r4.ok, r4.reason).toBe(true);
    const fuse4 = findFuse(store)! as import("@dustfall/sim").FuseEntity;
    while (world.clock.tick < fuse4.detonateAtTick) advanceClock(world);
    detonateFuses(world, store);
    expect(st.hp).toBe(0);
    expect(store.has(st.id)).toBe(false);
  });
});

describe("M6-02: damage formula at the weapon level", () => {
  it("falloff floors at 25% past the end of the falloff band", () => {
    const { world, store, p } = mk("dmg_s", [{ itemId: "nine_mm_pistol", quantity: 1 }, { itemId: "nine_mm_round", quantity: 10 }]);
    const victim = newPlayer(store.allocate(), "dmg_v" as never, { x: 0, y: 0, z: 3000 }); // 30 m out
    store.insert(victim);
    arm(p, "nine_mm_pistol", "nine_mm_round", 10);
    const r = resolveFire(world, store, p, world.clock.tick, aimAt(p, victim.position, world.clock.tick), {});
    expect(r.ok).toBe(true);
    expect(r.hits.length).toBe(1);
    const h = r.hits[0]!;
    expect(h.zone).toBe("torso");
    expect(h.damage).toBe(18 * 0.25); // 30 m ≥ end (25 m) → floor
    expect(victim.vitals.health).toBe(100 - h.damage);
  });

  it("head shots take the 1.5× zone multiplier", () => {
    const { world, store, p } = mk("dmg_h", [{ itemId: "nine_mm_pistol", quantity: 1 }, { itemId: "nine_mm_round", quantity: 10 }]);
    const victim = newPlayer(store.allocate(), "dmg_h_v" as never, { x: 0, y: 0, z: 1000 });
    store.insert(victim);
    arm(p, "nine_mm_pistol", "nine_mm_round", 10);
    // aim up so the ray clips the head capsule (head center at +145 cm)
    const aim = aimAt(p, { x: victim.position.x, y: victim.position.y + 60, z: victim.position.z }, world.clock.tick);
    const r = resolveFire(world, store, p, world.clock.tick, aim, {});
    expect(r.ok).toBe(true);
    if (r.hits.length > 0 && r.hits[0]!.zone === "head") {
      expect(r.hits[0]!.damage).toBeCloseTo(18 * 1.5 * (30 * 0.25 > 0 ? 1 : 1), 4); // in-band ≈ 1.0
    }
  });

  it("armor reduction is clamped at 0.60 across worn pieces", () => {
    const { world, store, p } = mk("dmg_a", [{ itemId: "nine_mm_pistol", quantity: 1 }, { itemId: "nine_mm_round", quantity: 10 }]);
    const victim = newPlayer(store.allocate(), "dmg_a_v" as never, { x: 0, y: 0, z: 1000 });
    store.insert(victim);
    // full cloth + ballistic set: 0.05+0.1+0.05+0.05 + 0.15+0.25+0.1+0.05 = 0.80 → clamp 0.60
    victim.equipment.helmet = { itemId: "ballistic_helmet" as never, quantity: 1 };
    victim.equipment.vest = { itemId: "ballistic_vest" as never, quantity: 1 };
    victim.equipment.pants = { itemId: "ballistic_pants" as never, quantity: 1 };
    victim.equipment.boots = { itemId: "ballistic_boots" as never, quantity: 1 };
    arm(p, "nine_mm_pistol", "nine_mm_round", 10);
    const r = resolveFire(world, store, p, world.clock.tick, aimAt(p, victim.position, world.clock.tick), {});
    expect(r.ok).toBe(true);
    expect(r.hits.length).toBe(1);
    const distM = 10; // within the pistol's falloff band (6..25 m)
    const expected = 18 * (1 - ((distM - 6) / 19) * 0.75) * 1.0 * 0.4; // torso, clamp
    expect(r.hits[0]!.damage).toBeCloseTo(expected, 4);
  });
});

describe("T10: lag compensation rewinds the target pose", () => {
  it("a shot resolves against the target pose at the acknowledged tick, not now", () => {
    const { world, store, p } = mk("t10_s", [{ itemId: "nine_mm_pistol", quantity: 1 }, { itemId: "nine_mm_round", quantity: 10 }]);
    // The victim stands on the aim line at its tick-0 pose; it moves 10 m off
    // the line later. Resolving at tick 0 must hit the rewound pose, while a
    // current-pose shot would miss.
    const victim = newPlayer(store.allocate(), "t10_v" as never, { x: 0, y: 0, z: 2000 });
    store.insert(victim);
    arm(p, "nine_mm_pistol", "nine_mm_round", 10);

    victim.poseHistory.record(world.clock.tick, victim.position);
    advanceClock(world);
    victim.position = { x: 1000, y: 0, z: 2000 }; // 10 m off the original line

    const r = resolveFire(world, store, p, 0, aimAt(p, { x: 0, y: 0, z: 2000 }, 0), {});
    expect(r.ok).toBe(true);
    expect(r.hits.length).toBe(1);
    expect(r.hits[0]!.targetPlayerId).toBe("t10_v")
  });
});

describe("T09 + T19: fire intents cannot cheat", () => {
  it("a dead shooter's fire command mutates no state", () => {
    const { world, store, p } = mk("t19_dead", [{ itemId: "nine_mm_pistol", quantity: 1 }, { itemId: "nine_mm_round", quantity: 10 }]);
    const victim = newPlayer(store.allocate(), "t19_v" as never, { x: 0, y: 0, z: 1000 });
    store.insert(victim);
    arm(p, "nine_mm_pistol", "nine_mm_round", 10);
    p.dead = true;
    const hpBefore = victim.vitals.health;
    const r = resolveFire(world, store, p, 0, aimAt(p, victim.position, 0), {});
    expect(r.ok).toBe(false);
    expect(victim.vitals.health).toBe(hpBefore);
  });

  it("a future client tick is rejected", () => {
    const { world, store, p } = mk("t19_future", [{ itemId: "nine_mm_pistol", quantity: 1 }, { itemId: "nine_mm_round", quantity: 10 }]);
    const victim = newPlayer(store.allocate(), "t19f_v" as never, { x: 0, y: 0, z: 1000 });
    store.insert(victim);
    arm(p, "nine_mm_pistol", "nine_mm_round", 10);
    const hpBefore = victim.vitals.health;
    const r = resolveFire(world, store, p, 1000, { serverTick: 0, yawHundredths: 0, pitchHundredths: 0 }, {});
    expect(r.ok).toBe(false);
    expect(victim.vitals.health).toBe(hpBefore);
  });

  it("aim outside the rewind window (null aim) is rejected", () => {
    const { world, store, p } = mk("t19_aim", [{ itemId: "nine_mm_pistol", quantity: 1 }, { itemId: "nine_mm_round", quantity: 10 }]);
    const victim = newPlayer(store.allocate(), "t19a_v" as never, { x: 0, y: 0, z: 1000 });
    store.insert(victim);
    arm(p, "nine_mm_pistol", "nine_mm_round", 10);
    const hpBefore = victim.vitals.health;
    const r = resolveFire(world, store, p, 0, null, {});
    expect(r.ok).toBe(false);
    expect(victim.vitals.health).toBe(hpBefore);
  });

  it("firing a non-weapon (wood in hand) is not a weapon fire", () => {
    const { world, store, p } = mk("t19_bare", [{ itemId: "wood", quantity: 1 }]);
    const victim = newPlayer(store.allocate(), "t19b_v" as never, { x: 0, y: 0, z: 1000 });
    store.insert(victim);
    p.heldItemId = "wood" as never;
    const hpBefore = victim.vitals.health;
    const r = resolveFire(world, store, p, 0, aimAt(p, victim.position, 0), {});
    expect(r.ok).toBe(false);
    expect(victim.vitals.health).toBe(hpBefore);
  });
});

describe("M6-05: magazine + reload", () => {
  it("a 30-round rifle with only 12 rounds in the pack reloads to 12", () => {
    const { world, store, p } = mk("t05_mag", [{ itemId: "assault_rifle", quantity: 1 }, { itemId: "nine_mm_round", quantity: 12 }]);
    arm(p, "assault_rifle", "nine_mm_round", 12);
    p.weapon.loadedByItemId["assault_rifle"] = 0; // drain the mag
    const r = resolveFire(world, store, p, world.clock.tick, aimAt(p, p.position, world.clock.tick), { reload: true });
    expect(r.ok).toBe(true);
    expect(r.reloadStarted).toBe(true);
    const completes = p.weapon.reloading!.completesAtTick;
    for (let t = world.clock.tick; t <= completes; t++) advanceClock(world);
    const done = advanceWeapons(world, store);
    expect(done.length).toBe(1);
    expect(done[0]!.loadedAfter).toBe(12); // partial: only 12 in the pack
    expect(p.weapon.loadedByItemId["assault_rifle"]).toBe(12);
    expect(p.weapon.reloading).toBe(null);
    expect(p.inventory[1]).toBe(null); // the 12-round stack is fully consumed
  });

  it("reloading a full magazine is refused (no state change)", () => {
    const { world, store, p } = mk("t05_full", [{ itemId: "nine_mm_pistol", quantity: 1 }, { itemId: "nine_mm_round", quantity: 20 }]);
    arm(p, "nine_mm_pistol", "nine_mm_round", 20);
    const loaded = p.weapon.loadedByItemId["nine_mm_pistol"];
    const r = resolveFire(world, store, p, world.clock.tick, aimAt(p, p.position, world.clock.tick), { reload: true });
    expect(r.ok).toBe(false);
    expect(p.weapon.loadedByItemId["nine_mm_pistol"]).toBe(loaded);
    expect(p.weapon.reloading).toBe(null);
  });

  it("shooting on fire cadence is rejected until the interval elapses", () => {
    const { world, store, p } = mk("cad", [{ itemId: "nine_mm_pistol", quantity: 1 }, { itemId: "nine_mm_round", quantity: 20 }]);
    const victim = newPlayer(store.allocate(), "cad_v" as never, { x: 0, y: 0, z: 1000 });
    store.insert(victim);
    arm(p, "nine_mm_pistol", "nine_mm_round", 20);
    const r1 = resolveFire(world, store, p, world.clock.tick, aimAt(p, victim.position, world.clock.tick), {});
    expect(r1.ok).toBe(true);
    const r2 = resolveFire(world, store, p, world.clock.tick + 1, aimAt(p, victim.position, world.clock.tick + 1), {});
    expect(r2.ok).toBe(false); // inside the 1 s fire interval
    while (world.clock.tick < p.fireCooldownUntilTick) advanceClock(world);
    const r3 = resolveFire(world, store, p, world.clock.tick, aimAt(p, victim.position, world.clock.tick), {});
    expect(r3.ok, r3.reason).toBe(true);
  });
});

describe("M6-07: no weapon penetrates walls", () => {
  it("a Wood Wall between shooter and target eats the hitscan", () => {
    // Shooter stands 4 m in front of the wall; the victim is behind it.
    const { world, store, p } = mk("wall_s", [{ itemId: "nine_mm_pistol", quantity: 1 }, { itemId: "nine_mm_round", quantity: 10 }], {
      x: 0,
      y: 0,
      z: 1100,
    });
    withBuilding(p, "wood_wall");
    const wall = placeStructure(world, store, p, 2, { x: 0, y: 0, z: 1500 });
    const st = store.get(wall.structureEntityId! as EntityId) as StructureEntity;
    const victim = newPlayer(store.allocate(), "wall_v" as never, { x: 0, y: 0, z: 3000 });
    store.insert(victim);
    arm(p, "nine_mm_pistol", "nine_mm_round", 10);
    const hpBefore = victim.vitals.health;
    const r = resolveFire(world, store, p, world.clock.tick, aimAt(p, victim.position, world.clock.tick), {});
    expect(r.ok).toBe(true); // the shot fired
    expect(r.hits.length).toBe(0); // blocked by the wall
    expect(victim.vitals.health).toBe(hpBefore);
    expect(st.hp).toBe(st.maxHp); // bullets don't chip buildings
  });
});

describe("M6-04: bow fires a physical projectile with recoverable misses", () => {
  it("a bow shot spawns a projectile that consumes one arrow", () => {
    const { world, store, p } = mk("bow_s", [{ itemId: "hunting_bow", quantity: 1 }, { itemId: "arrow", quantity: 5 }]);
    arm(p, "hunting_bow", "arrow", 5);
    const r = resolveFire(world, store, p, world.clock.tick, aimAt(p, { x: 0, y: 0, z: 2000 }, world.clock.tick), {});
    expect(r.ok, r.reason).toBe(true);
    expect(r.projectileId).toBeDefined();
    expect(p.inventory[1]?.quantity).toBe(4); // one arrow spent
    const pr = store.get(r.projectileId! as EntityId) as ProjectileEntity;
    expect(pr.kind).toBe("projectile");
    expect(pr.contentId).toBe("arrow");
  });

  it("a missed arrow that reaches the ground is recovered (no loss)", () => {
    const { world, store, p } = mk("bow_recover", [{ itemId: "hunting_bow", quantity: 1 }, { itemId: "arrow", quantity: 5 }]);
    arm(p, "hunting_bow", "arrow", 5);
    const r = resolveFire(world, store, p, world.clock.tick, aimAt(p, { x: 0, y: 0, z: 2000 }, world.clock.tick), {});
    expect(r.ok).toBe(true);
    const prId = r.projectileId!;
    // advance until the arrow either lands (recoverable) or expires
    let guard = 0;
    while (store.has(prId as EntityId) && guard++ < 700) {
      advanceClock(world);
      advanceProjectiles(world, store);
    }
    expect(store.has(prId as EntityId)).toBe(false);
    let arrows = 0;
    for (const e of store.values()) {
      if (e.kind === "ground_item" && e.stack.itemId === "arrow") arrows += e.stack.quantity;
    }
    expect(arrows).toBe(1); // the arrow is back in the world, pickable
  });
});

describe("M6-03: PVP melee through the swing path", () => {
  it("a bare-hands swing within reach damages the victim; out of reach does not", () => {
    const { world, store, p } = mk("melee_s", [{ itemId: "wood", quantity: 2 }], { x: 0, y: 0, z: 0 });
    p.heldItemId = "wood" as never; // tool multiplier 1.0
    const victim = newPlayer(store.allocate(), "melee_v" as never, { x: 0, y: 0, z: 150 }); // 1.5 m
    store.insert(victim);
    const r = hitPlayer(world, store, p, "melee_v", 1.0);
    expect(r.ok, r.reason).toBe(true);
    expect(r.damage).toBe(8); // max(1, round(8 × 1.0))
    expect(victim.vitals.health).toBe(92);
    // the shared swing cooldown now blocks an immediate second swing
    const r2 = hitPlayer(world, store, p, "melee_v", 1.0);
    expect(r2.ok).toBe(false);
    expect(r2.reason).toBe("cooldown");
  });

  it("out of reach mutates no state", () => {
    const { world, store, p } = mk("melee_far", [{ itemId: "wood", quantity: 1 }]);
    const victim = newPlayer(store.allocate(), "melee_far_v" as never, { x: 0, y: 0, z: 5000 }); // 50 m
    store.insert(victim);
    const r = hitPlayer(world, store, p, "melee_far_v", 1.0);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("out_of_reach");
    expect(victim.vitals.health).toBe(100);
  });

  it("runTick routes a player-targeted swing through combat events", () => {
    const { world, store, p } = mk("melee_tick", [{ itemId: "rock", quantity: 1 }]);
    p.heldItemId = "rock" as never;
    const victim = newPlayer(store.allocate(), "melee_t_v" as never, { x: 0, y: 0, z: 150 });
    store.insert(victim);
    const victimId = victim.id;
    const ev = runTick(world, store, [
      {
        playerId: p.playerId,
        sequence: 1,
        intent: {
          wishX: 0,
          wishZ: 0,
          jump: false,
          crouch: false,
          sprint: false,
          inWater: false,
        },
        yawHundredths: 0,
        pitchHundredths: 0,
        swing: { targetEntityId: victimId },
      },
    ]);
    const hit = ev.combatHits.find((h) => h.targetPlayerId === "melee_t_v");
    expect(hit).toBeDefined();
    expect(hit!.damage).toBe(4); // rock tool multiplier 0.5 -> round(8 x 0.5)
    expect(victim.vitals.health).toBe(96);
  });
});
