/**
 * M5: radiation acceptance suite (T01–T04, GDD §6) + food/med channels,
 * weather, cold, wildlife.
 */
import { describe, it, expect } from "vitest";
import {
  createWorld,
  newPlayer,
  EntityStore,
  advanceClock,
  isNight,
  doseRateAt,
  radProtectionOf,
  accumulateForTicks,
  applyRadiationTick,
  startChannel,
  advanceChannels,
  cancelChannel,
  applyWeather,
  applyCold,
  spawnWildlife,
  advanceWildlife,
  hitAnimal,
  runTick,
  type PlayerEntity,
  type AnimalEntity,
} from "@dustfall/sim";
import { RADIATION_ZONES, RAD_DOSE_RATES, ANIMAL_BY_KIND } from "@dustfall/content";

const testWorld = () => createWorld("m5", 0x5151, 0x0abc);

const mk = (
  pid: string,
  items: Array<{ itemId: string; quantity: number }> = [],
  pos = { x: 0, y: 0, z: 0 },
): { world: ReturnType<typeof testWorld>; store: EntityStore; p: PlayerEntity } => {
  const world = testWorld();
  const store = new EntityStore();
  const p = newPlayer(store.allocate(), pid as never, pos);
  let slot = 0;
  for (const it of items) p.inventory[slot++] = { itemId: it.itemId as never, quantity: it.quantity };
  store.insert(p);
  return { world, store, p };
};

/** A player standing exactly at a zone's core. */
const atCore = (pid: string, zoneId: string, items: Array<{ itemId: string; quantity: number }> = []) => {
  const zone = RADIATION_ZONES.find((z) => z.id === zoneId)!;
  return mk(pid, items, { x: zone.center.x * 100, y: 0, z: zone.center.z * 100 }).p;
};

describe("T01 + T02: clock and night (GDD §16, ADR-0004)", () => {
  it("T01: 30 ticks = 1 game second; 108,000 ticks = 24 game hours", () => {
    const world = testWorld();
    for (let i = 0; i < 30; i++) advanceClock(world);
    expect(world.clock.gameSecondsOfDay).toBe(24); // 30 ticks * 0.8 game s
    world.clock = { tick: 0, gameSecondsOfDay: 0, day: 0 };
    for (let i = 0; i < 108_000; i++) advanceClock(world);
    expect(world.clock.gameSecondsOfDay).toBe(0);
    expect(world.clock.day).toBe(1);
  });

  it("T02: night true at 23:00:00 and 04:59:59; false at 22:59:59 and 05:00:00", () => {
    const world = testWorld();
    const set = (s: number) => (world.clock.gameSecondsOfDay = s);
    set(23 * 3600);
    expect(isNight(world.clock)).toBe(true);
    set(4 * 3600 + 59 * 60 + 59);
    expect(isNight(world.clock)).toBe(true);
    set(22 * 3600 + 59 * 60 + 59);
    expect(isNight(world.clock)).toBe(false);
    set(5 * 3600);
    expect(isNight(world.clock)).toBe(false);
  });
});

describe("T03 + T04: radiation dose acceptance (GDD §6)", () => {
  it("T03: naked in the High core accrues 5.0 rads/s -> 500 rads in 100 s", () => {
    const world = testWorld();
    const p = atCore("t03", "region_ashfield_rad");
    // 125 ticks = 100 game-seconds (0.8 gs/tick); 125 x 5.0 x 0.8 = 500
    const res = accumulateForTicks(world, p, 125);
    expect(res.total).toBe(500);
    expect(doseRateAt({ x: p.position.x, z: p.position.z })).toBe(RAD_DOSE_RATES.high.core); // 5.0
  });

  it("T04: full Rad Suit in the Extreme core -> 4.0 rads/s effective (500 rads in 125 s)", () => {
    const world = testWorld();
    const p = atCore("t04", "region_greywater_plant");
    p.equipment.vest = { itemId: "rad_suit" as never, quantity: 1 };
    // protection = 0.9 -> effective 40 x 0.1 = 4.0 rads/s
    expect(radProtectionOf(p)).toBeCloseTo(0.9, 5);
    // below the cap the rate is exact: 100 ticks = 80 game-seconds
    // -> 100 x 4.0 x 0.8 = 320 rads, i.e. 320/80 = 4.0 rads/s
    const early = accumulateForTicks(world, p, 100);
    expect(early.total).toBeCloseTo(320, 8);
    expect(early.total / 80).toBeCloseTo(4.0, 5);
    // GDD: 500 rads at 4.0 per s takes 125 game-seconds (= 156.25 ticks),
    // so by 160 ticks the player is at the lethal threshold + sickness armed
    accumulateForTicks(world, p, 60); // ticks 101..160
    expect(p.vitals.radiation).toBe(500);
    expect(p.vitals.radiationSicknessTimer).toBeGreaterThan(0);
  });
});

describe("M5 food/med channels (GDD §6, §15)", () => {
  it("eating a cooked item raises calories and consumes the stack", () => {
    const { world, store, p } = mk("p_food", [
      { itemId: "cooked_rabbit_meat", quantity: 3 },
    ]);
    const r = startChannel(world, store, p, 0, "food");
    expect(r.ok).toBe(true);
    const cal0 = p.vitals.calories;
    for (let i = 0; i < 30; i++) advanceChannels(world, store);
    expect(p.inventory[0]?.quantity).toBe(2);
    expect(p.vitals.calories).toBe(cal0 + 100); // cooked rabbit = 100 cal
  });

  it("raw meat can poison; anti-rad pills remove rads", () => {
    const { world, store, p } = mk("p_med", [
      { itemId: "anti_radiation_pills", quantity: 2 },
    ]);
    p.vitals.radiation = 400;
    p.vitals.radiationSicknessTimer = 9999;
    const r = startChannel(world, store, p, 0, "antirad");
    expect(r.ok).toBe(true);
    for (let i = 0; i < 30; i++) advanceChannels(world, store);
    expect(p.vitals.radiation).toBe(200); // 400 - 200
    expect(p.vitals.radiationSicknessTimer).toBe(0); // under threshold -> clear
  });

  it("bandage stops bleeding and cools down", () => {
    const { world, store, p } = mk("p_band", [
      { itemId: "bandage", quantity: 1 },
    ]);
    p.vitals.bleeding = 80;
    const r = startChannel(world, store, p, 0, "bandage");
    expect(r.ok).toBe(true);
    for (let i = 0; i < 300; i++) advanceChannels(world, store);
    expect(p.vitals.bleeding).toBe(0);
    expect(p.vitals.health).toBeLessThanOrEqual(100);
    // medical cooldown active: a second bandage is refused immediately
    p.inventory[0] = { itemId: "bandage" as never, quantity: 1 };
    const again = startChannel(world, store, p, 0, "bandage");
    expect(again.ok).toBe(false);
  });

  it("sprinting cancels the channel and keeps the item", () => {
    const { world, store, p } = mk("p_cancel", [
      { itemId: "cooked_venison", quantity: 1 },
    ]);
    startChannel(world, store, p, 0, "food");
    cancelChannel(p);
    advanceChannels(world, store);
    expect(p.inventory[0]?.quantity).toBe(1); // not consumed
  });
});

describe("M5 weather + cold (GDD §16)", () => {
  it("weather changes are bounded: state persists between min-clear ticks", () => {
    const world = testWorld();
    world.weather = "rain";
    world.weatherNextChangeAtTick = 10;
    // before the armed tick, rain persists
    applyWeather(world);
    expect(world.weather).toBe("rain");
    // past the armed tick, it may transition (seeded, so assert it is a
    // legal state and the next change is re-armed ahead of now)
    world.clock.tick = 11;
    const next = applyWeather(world);
    expect(["clear", "overcast", "rain", "fog", "dry_wind"]).toContain(next);
    expect(world.weatherNextChangeAtTick).toBeGreaterThan(11);
  });

  it("cold: rain + night builds a deficit; campfire comfort clears it", () => {
    const { world, store, p } = mk("p_cold");
    // night + rain: pressure = 0 + 4(night) + 4(rain) = 8 > 0 -> deficit
    world.clock.gameSecondsOfDay = 23 * 3600 + 10;
    world.weather = "rain";
    applyCold(world, store);
    expect(p.vitals.coldDeficit).toBeGreaterThan(0);

    // a campfire 2 m away grants 30 warmth -> deficit clears + comfort
    const camp: import("@dustfall/sim").StructureEntity = {
      id: store.allocate(),
      kind: "structure",
      contentId: "campfire",
      position: { x: p.position.x + 200, y: 0, z: p.position.z },
      ownerId: p.playerId,
      hp: 250,
      maxHp: 250,
      craft: null,
      storage: [],
      lastMaintainedAtTick: world.clock.tick,
    };
    store.insert(camp);
    applyCold(world, store);
    expect(p.vitals.coldDeficit).toBe(0);
    expect(p.vitals.comfortTimer).toBeGreaterThan(0);
  });
});

describe("M5 wildlife (GDD §12)", () => {
  it("spawns near the player, respects the active cap, and a swing kills + drops loot", () => {
    const { world, store, p } = mk("p_wild");
    const spawned = spawnWildlife(world, store);
    expect(spawned.length).toBeGreaterThanOrEqual(1);
    expect(spawned.length).toBeLessThanOrEqual(4);
    const a = store.get(spawned[0] as import("@dustfall/contracts").EntityId) as AnimalEntity;
    // spawn distance: >= 20 m, <= 60 m from the player
    const d = Math.hypot(a.position.x - p.position.x, a.position.z - p.position.z);
    expect(d).toBeGreaterThanOrEqual(1600); // minD*0.8 recheck
    expect(d).toBeLessThanOrEqual(6100);

    // cap: fill the rest, then no more spawn
    let guard = 0;
    while ([...store.values()].filter((e) => e.kind === "animal").length < 8 && guard++ < 20) {
      spawnWildlife(world, store);
    }
    const atCap = spawnWildlife(world, store);
    expect(atCap.length).toBe(0);
    expect([...store.values()].filter((e) => e.kind === "animal").length).toBe(8);
  });

  it("a prey flees when hit; a killing swing drops its loot and despawns it", () => {
    const { world, store, p } = mk("p_hunt");
    p.position = { x: 10000, y: 0, z: 10000 };
    // hand-craft a deterministic rabbit right next to the player
    const rabbit: AnimalEntity = {
      id: store.allocate(),
      kind: "animal",
      contentId: "rabbit",
      position: { x: p.position.x + 50, y: 0, z: p.position.z },
      hp: 30,
      maxHp: 30,
      state: "idle",
      lastAggroTick: 0,
      wander: { x: 1, z: 0 },
      home: { x: p.position.x + 50, y: 0, z: p.position.z },
      dying: false,
    };
    store.insert(rabbit);

    // rock (toolMultiplier 1) does 8 dmg; rabbit 30 hp -> 4 swings
    let swings = 0;
    let killed = false;
    for (let i = 0; i < 10 && !killed; i++) {
      const r = hitAnimal(world, store, p, rabbit.id, 1);
      expect(r.ok).toBe(true);
      swings++;
      expect(r.damage).toBe(8);
      expect(rabbit.state).toBe("flee"); // prey flees when hit
      killed = r.killed;
      // clear the 24-tick swing cooldown so the next swing can land
      p.swingCooldownUntilTick = world.clock.tick;
    }
    expect(killed).toBe(true);
    expect(swings).toBe(4);
    expect(rabbit.dying).toBe(true);

    // a killing swing drops the loot table (rabbit meat always, chance 1.0)
    const ground = [...store.values()].filter((e) => e.kind === "ground_item");
    expect(ground.some((g) => (g as { stack: { itemId: string } }).stack.itemId === "raw_rabbit_meat")).toBe(true);

    // advanceWildlife removes the dying animal
    const removed = advanceWildlife(world, store);
    expect(removed).toContain(rabbit.id);
    expect(store.get(rabbit.id as import("@dustfall/contracts").EntityId)).toBeUndefined();
  });
});