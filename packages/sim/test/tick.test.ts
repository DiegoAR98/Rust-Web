import { describe, expect, it } from "vitest";
import { createWorld, runTick, advanceClock, isNight, DAY_TICKS, type TickCommand } from "../src/index.js";
import { EntityStore, newPlayer } from "../src/index.js";
import type { PlayerId } from "@dustfall/contracts";

const world = () => createWorld("test", 0x1234, 0x5678);

describe("fixed tick (T01)", () => {
  it("30 ticks = 1 real second (ADR-0004)", () => {
    const w = world();
    for (let i = 0; i < 30; i++) advanceClock(w);
    expect(w.clock.gameSecondsOfDay).toBe(24); // 30 real s × 0.8 game s/tick
  });

  it("108,000 ticks = 86,400 game seconds = 1 day", () => {
    const w = world();
    for (let i = 0; i < 108_000; i++) advanceClock(w);
    expect(w.clock.gameSecondsOfDay).toBe(0);
    expect(w.clock.day).toBe(1);
    expect(w.clock.tick).toBe(108_000);
  });

  it("day length matches tuning", () => {
    expect(DAY_TICKS).toBe(3600 * 30);
  });
});

describe("night boundaries (T02)", () => {
  // isNight is the function under test; exact seconds per T02
  const at = (h: number, m: number, s: number): boolean =>
    isNight({ tick: 0, gameSecondsOfDay: h * 3600 + m * 60 + s, day: 0 });

  it("true at 23:00:00 and 04:59:59", () => {
    expect(at(23, 0, 0)).toBe(true);
    expect(at(4, 59, 59)).toBe(true);
  });
  it("false at 22:59:59 and 05:00:00", () => {
    expect(at(22, 59, 59)).toBe(false);
    expect(at(5, 0, 0)).toBe(false);
  });

  it("tick-aligned boundaries: 23:00:00 is tick 103500, 05:00:00 is tick 22500", () => {
    const w = world();
    for (let i = 0; i < 103_500; i++) advanceClock(w);
    expect(w.clock.gameSecondsOfDay).toBe(23 * 3600);
    expect(isNight(w.clock)).toBe(true);

    const w2 = world();
    for (let i = 0; i < 22_500; i++) advanceClock(w2);
    expect(w2.clock.gameSecondsOfDay).toBe(5 * 3600);
    expect(isNight(w2.clock)).toBe(false);
  });
});

describe("movement", () => {
  it("walk speed matches tuning (3.5 m/s)", () => {
    const w = world();
    const store = new EntityStore();
    const id = store.allocate();
    const p = newPlayer(id, "p_alice" as PlayerId, { x: 0, y: 0, z: 0 });
    store.insert(p);
    const tick: TickCommand = {
      playerId: "p_alice",
      sequence: 1,
      intent: { wishX: 100, wishZ: 0, jump: false, crouch: false, sprint: false, inWater: false },
      yawHundredths: 0,
      pitchHundredths: 0,
    };
    for (let i = 0; i < 30; i++) runTick(w, store, [tick]);
    // 30 ticks = 1 s -> ~3.5 m = 350 cm
    expect(p.position.x).toBeGreaterThan(330);
    expect(p.position.x).toBeLessThan(370);
  });

  it("sprint is faster than walk", () => {
    const mk = (): { p: ReturnType<typeof newPlayer>; w: ReturnType<typeof world>; store: EntityStore } => {
      const w = world();
      const store = new EntityStore();
      const id = store.allocate();
      const p = newPlayer(id, "p_bob" as PlayerId, { x: 0, y: 0, z: 0 });
      store.insert(p);
      return { p, w, store };
    };
    const a = mk();
    const b = mk();
    const intent = (sprint: boolean) => ({
      wishX: 100, wishZ: 0, jump: false, crouch: false, sprint, inWater: false,
    });
    for (let i = 0; i < 60; i++) {
      runTick(a.w, a.store, [{ playerId: "p_bob", sequence: i + 1, intent: intent(false), yawHundredths: 0, pitchHundredths: 0 }]);
      runTick(b.w, b.store, [{ playerId: "p_bob", sequence: i + 1, intent: intent(true), yawHundredths: 0, pitchHundredths: 0 }]);
    }
    expect(b.p.position.x).toBeGreaterThan(a.p.position.x);
  });

  it("jump applies impulse and gravity returns the player to ground", () => {
    const w = world();
    const store = new EntityStore();
    const id = store.allocate();
    const p = newPlayer(id, "p_carol" as PlayerId, { x: 0, y: 0, z: 0 });
    store.insert(p);
    const tick: TickCommand = {
      playerId: "p_carol",
      sequence: 1,
      intent: { wishX: 0, wishZ: 0, jump: true, crouch: false, sprint: false, inWater: false },
      yawHundredths: 0,
      pitchHundredths: 0,
    };
    runTick(w, store, [tick]);
    expect(p.position.y).toBeGreaterThan(0);
    for (let i = 1; i < 60; i++) {
      runTick(w, store, [{ ...tick, sequence: i + 1, intent: { ...tick.intent, jump: false } }]);
    }
    expect(p.position.y).toBe(0);
    expect(p.onGround).toBe(true);
  });
});

describe("determinism (T14)", () => {
  it("same seed and command log produce identical state after 300 ticks", () => {
    const mkLog = (playerId: string): TickCommand[] =>
      Array.from({ length: 300 }, (_, i) => ({
        playerId,
        sequence: i + 1,
        intent: {
          wishX: i % 7 === 0 ? 100 : 0,
          wishZ: i % 5 === 0 ? -80 : 0,
          jump: i % 90 === 0,
          crouch: i % 40 < 10,
          sprint: i % 20 < 5,
          inWater: false,
        },
        yawHundredths: i,
        pitchHundredths: 0,
      }));

    const run = (): { x: number; y: number; z: number; hp: number } => {
      const w = createWorld("det", 0xabcd, 0x1234);
      const store = new EntityStore();
      const id = store.allocate();
      const p = newPlayer(id, "p_det" as PlayerId, { x: 0, y: 0, z: 0 });
      store.insert(p);
      const log = mkLog("p_det");
      for (let i = 0; i < 300; i++) runTick(w, store, log.slice(i, i + 1));
      return { x: p.position.x, y: p.position.y, z: p.position.z, hp: p.vitals.health };
    };
    expect(run()).toEqual(run());
  });
});

describe("vitals", () => {
  it("starvation drains health at 0 hp... 0 calories", () => {
    const w = world();
    const store = new EntityStore();
    const id = store.allocate();
    const p = newPlayer(id, "p_dave" as PlayerId, { x: 0, y: 0, z: 0 });
    p.vitals.calories = 0;
    store.insert(p);
    const before = p.vitals.health;
    for (let i = 0; i < 30; i++) {
      runTick(w, store, [{
        playerId: "p_dave",
        sequence: i + 1,
        intent: { wishX: 0, wishZ: 0, jump: false, crouch: false, sprint: false, inWater: false },
        yawHundredths: 0,
        pitchHundredths: 0,
      }]);
    }
    // 1 s of starvation: ~0.25 hp
    expect(p.vitals.health).toBeLessThan(before);
    expect(before - p.vitals.health).toBeGreaterThan(0.2);
    expect(before - p.vitals.health).toBeLessThan(0.35);
  });
});
