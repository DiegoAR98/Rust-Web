/**
 * M6: combat core (GDD §11, backlog M6-01 + M6-02).
 * - M6-01: zone capsules match fixtures; 20-tick position ring clamps poses.
 * - M6-02: damage formula, 0.60 armor clamp, mixed armor sets, whole-hp.
 */
import { describe, it, expect } from "vitest";
import {
  CHARACTER_CAPSULE,
  resolveHitZone,
  zoneMultiplier,
  PositionHistory,
  historyDepth,
  computeDamage,
  armorReduction,
  falloffMultiplier,
  type ArmorItem,
} from "@dustfall/sim";
import { TUNING } from "@dustfall/content";

const feet = { x: 0, y: 0, z: 0 };
const noArmor: ArmorItem[] = [];

describe("M6-01: hitbox profiles", () => {
  it("resolves the head zone on a point at head height, centered", () => {
    expect(resolveHitZone(CHARACTER_CAPSULE, feet, { x: 0, y: CHARACTER_CAPSULE.headCenterCm, z: 0 })).toBe("head");
  });

  it("resolves the torso zone mid-chest", () => {
    expect(resolveHitZone(CHARACTER_CAPSULE, feet, { x: 0, y: CHARACTER_CAPSULE.torsoCenterCm, z: 0 })).toBe("torso");
  });

  it("resolves the limb zone in the limb band", () => {
    expect(resolveHitZone(CHARACTER_CAPSULE, feet, { x: 10, y: 35, z: 0 })).toBe("limb");
  });

  it("misses the capsule when far away", () => {
    expect(resolveHitZone(CHARACTER_CAPSULE, feet, { x: 500, y: 80, z: 0 })).toBeNull();
  });

  it("targets the feet region as a limb (within the limb band reach)", () => {
    // 15 cm above the feet is inside the limb band and within reach
    expect(resolveHitZone(CHARACTER_CAPSULE, feet, { x: 0, y: 25, z: 0 })).toBe("limb");
  });

  it("zone multipliers: head 1.5, limb 0.75, torso 1 (TUNING)", () => {
    expect(zoneMultiplier("head", TUNING)).toBe(1.5);
    expect(zoneMultiplier("limb", TUNING)).toBe(0.75);
    expect(zoneMultiplier("torso", TUNING)).toBe(1);
  });
});

describe("M6-01: position history (20-tick ring)", () => {
  it("keeps exactly 20 ticks of poses", () => {
    expect(historyDepth()).toBe(20);
    const h = new PositionHistory();
    for (let t = 0; t < 50; t++) h.record(t, { x: t, y: 0, z: 0 });
    expect(h.poseAt(49)?.position.x).toBe(49);
    // 30 ticks back is outside the window
    expect(h.poseAt(0)).toBeNull();
  });

  it("rewinds to the newest pose at or before the requested tick", () => {
    const h = new PositionHistory();
    for (let t = 10; t <= 20; t++) h.record(t, { x: t * 100, y: 0, z: 0 });
    // a request between recorded ticks resolves to the older pose
    expect(h.poseAt(15)?.position.x).toBe(1500);
    expect(h.poseAt(1501)?.position.x).toBe(2000); // clamps to the newest
    expect(h.poseAt(9)).toBeNull(); // predates the window
  });

  it("oldest() reports the ring's oldest pose", () => {
    const h = new PositionHistory();
    for (let t = 0; t < 30; t++) h.record(t, { x: 0, y: 0, z: 0 });
    expect(h.oldest()?.tick).toBe(10);
  });
});

describe("M6-02: damage formula", () => {
  it("applies the full formula: base × falloff × zone × (1 - armor)", () => {
    const dmg = computeDamage({
      baseDamage: 100,
      distanceM: 5,
      falloffStartM: 5,
      falloffEndM: 25,
      zone: "head",
      wornArmor: noArmor,
    });
    // 100 × 1.0 (at falloff start) × 1.5 (head) × 1 = 150
    expect(dmg).toBe(150);
  });

  it("falloff is linear 1.0 → 0.25 between start and end", () => {
    expect(falloffMultiplier(0, 10, 30)).toBe(1);
    expect(falloffMultiplier(10, 10, 30)).toBe(1);
    expect(falloffMultiplier(30, 10, 30)).toBe(0.25);
    expect(falloffMultiplier(40, 10, 30)).toBe(0.25);
    // midpoint: 1 - 0.5×0.75 = 0.625
    expect(falloffMultiplier(20, 10, 30)).toBeCloseTo(0.625);
    // no-falloff weapon: always full damage
    expect(falloffMultiplier(999, 0, 0)).toBe(1);
  });

  it("limb hits take 0.75× the torso damage", () => {
    const torso = computeDamage({ baseDamage: 100, distanceM: 0, falloffStartM: 0, falloffEndM: 0, zone: "torso", wornArmor: noArmor });
    const limb = computeDamage({ baseDamage: 100, distanceM: 0, falloffStartM: 0, falloffEndM: 0, zone: "limb", wornArmor: noArmor });
    expect(limb).toBe(Math.round(torso * 0.75));
  });

  it("armor reductions sum across worn pieces, not just the struck slot", () => {
    const worn = [
      { damageReduction: 0.1 }, // helmet
      { damageReduction: 0.2 }, // vest
      { damageReduction: 0.05 }, // pants
      { damageReduction: 0.05 }, // boots
    ];
    // 100 × (1 - 0.40) = 60
    expect(armorReduction(worn)).toBeCloseTo(0.4);
    expect(computeDamage({ baseDamage: 100, distanceM: 0, falloffStartM: 0, falloffEndM: 0, zone: "torso", wornArmor: worn })).toBe(60);
  });

  it("clamps summed armor reduction at 0.60 (GDD §11)", () => {
    const over = [
      { damageReduction: 0.3 },
      { damageReduction: 0.4 },
      { damageReduction: 0.3 },
    ];
    expect(armorReduction(over)).toBe(0.6);
    // 100 × 0.4 = 40
    expect(computeDamage({ baseDamage: 100, distanceM: 0, falloffStartM: 0, falloffEndM: 0, zone: "torso", wornArmor: over })).toBe(40);
  });

  it("never reports less than 1 hp of damage", () => {
    const worn = [{ damageReduction: 0.59 }];
    const dmg = computeDamage({ baseDamage: 1, distanceM: 99, falloffStartM: 10, falloffEndM: 20, zone: "limb", wornArmor: worn });
    expect(dmg).toBeGreaterThanOrEqual(1);
  });
});
