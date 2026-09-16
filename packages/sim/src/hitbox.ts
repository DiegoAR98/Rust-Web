/**
 * M6: hitbox profiles and position history (GDD §11, backlog M6-01).
 *
 * - Every hittable character (player, animal) has a server-authored capsule
 *   profile: head / torso / limb zones. The animated mesh never decides
 *   hits (GDD §11 "damage formula" — hit zone is resolved from the capsule).
 * - The server stores a 20-tick position history per entity. A shot resolves
 *   against the target pose at the shooter's acknowledged client tick,
 *   clamped to that window (lag compensation, GDD §11 "Rewind and fairness").
 *
 * Units: positions in cm (1 m = 100 cm), same as every other sim module.
 */
import { TUNING } from "@dustfall/content";
import type { Vec3 } from "@dustfall/contracts";

export type HitZone = "head" | "torso" | "limb";

/**
 * Server-authored capsule profile. Players and animals share the same
 * proportions for the vertical slice; per-creature overrides land with M7.
 */
export interface CapsuleProfile {
  /** torso sphere radius, cm */
  torsoRadiusCm: number;
  /** torso center height above the position (feet), cm */
  torsoCenterCm: number;
  /** head sphere radius, cm */
  headRadiusCm: number;
  /** head center height above the position (feet), cm */
  headCenterCm: number;
  /** limb band: y in [limbLowCm, limbHighCm] around the torso axis */
  limbLowCm: number;
  limbHighCm: number;
}

export const CHARACTER_CAPSULE: CapsuleProfile = {
  torsoRadiusCm: 20,
  torsoCenterCm: 80,
  headRadiusCm: 14,
  headCenterCm: 145,
  limbLowCm: 20,
  limbHighCm: 55,
};

/**
 * Resolve which capsule zone a point (world, cm) hits.
 * - head: within headRadiusCm of the head center
 * - limb: horizontal distance within torsoRadiusCm*1.2 AND y within the
 *   limb band
 * - torso: otherwise, when the point is within the capsule's reach
 * - null: the point misses the capsule entirely
 */
export const resolveHitZone = (
  profile: CapsuleProfile,
  targetFeet: Vec3,
  point: { x: number; y: number; z: number },
): HitZone | null => {
  const hdx = point.x - targetFeet.x;
  const hdy = point.y - targetFeet.y;
  const hdz = point.z - targetFeet.z;
  const distXZ = Math.hypot(hdx, hdz);
  const relY = hdy; // height above feet

  // head zone (checked first: it overlaps the torso top)
  const headC = Math.hypot(distXZ, relY - profile.headCenterCm);
  if (headC <= profile.headRadiusCm) return "head";

  // torso zone: within torso radius horizontally, between limb band top and
  // head base
  if (distXZ <= profile.torsoRadiusCm && relY >= profile.limbHighCm && relY <= profile.headCenterCm - profile.headRadiusCm * 0.5) {
    return "torso";
  }

  // limb zone: slightly wider than the torso, in the limb band
  if (distXZ <= profile.torsoRadiusCm * 1.2 && relY >= profile.limbLowCm && relY <= profile.limbHighCm) {
    return "limb";
  }

  return null;
};

/** Zone damage multipliers live in TUNING ("combat.head_multiplier" etc). */
export const zoneMultiplier = (zone: HitZone, tuning: Record<string, number | string | boolean> = TUNING): number => {
  switch (zone) {
    case "head":
      return Number(tuning["combat.head_multiplier"] ?? 1.5);
    case "limb":
      return Number(tuning["combat.limb_multiplier"] ?? 0.75);
    case "torso":
      return 1;
  }
};

/**
 * 20-tick position ring buffer (GDD §11 "the server stores 20 ticks of
 * position history"). Oldest entry first.
 */
export const historyDepth = (): number => Number(TUNING["combat.history_ticks"] ?? 20);

export interface PoseEntry {
  tick: number;
  position: Vec3;
}

export class PositionHistory {
  private ring: (PoseEntry | null)[] = [];
  private head = 0;

  constructor(depth = historyDepth()) {
    this.ring = new Array<PoseEntry | null>(depth).fill(null);
  }

  get depth(): number {
    return this.ring.length;
  }

  /** Record this tick's pose. */
  record(tick: number, position: Vec3): void {
    this.ring[this.head] = { tick, position: { ...position } };
    this.head = (this.head + 1) % this.ring.length;
  }

  /**
   * Latest recorded pose at or before `targetTick`, or null when the
   * history is empty or `targetTick` predates every stored pose
   * (out-of-window: the caller must reject the shot).
   */
  poseAt(targetTick: number): PoseEntry | null {
    if (this.ring.every((e) => e === null)) return null;
    let best: PoseEntry | null = null;
    for (const e of this.ring) {
      if (e === null) continue;
      if (e.tick > targetTick) continue;
      if (best === null || e.tick > best.tick) best = e;
    }
    return best;
  }

  /** Oldest pose in the ring (for window bounds). */
  oldest(): PoseEntry | null {
    let oldest: PoseEntry | null = null;
    for (const e of this.ring) {
      if (e === null) continue;
      if (oldest === null || e.tick < oldest.tick) oldest = e;
    }
    return oldest;
  }
}

export interface AimPose {
  yawHundredths: number;
  pitchHundredths: number;
}

/**
 * Per-client aim ring: clientTick -> { serverTick, yaw, pitch }. Ranged shots
 * resolve against the target pose at the shooter's acknowledged client tick
 * (GDD §11); this ring maps that client tick to the server tick it was
 * observed on, and sanity-checks aim deltas (T19).
 */
export class AimHistory {
  private ring: { clientTick: number; serverTick: number; yawHundredths: number; pitchHundredths: number }[] = [];
  private depth: number;

  constructor(depth = historyDepth()) {
    this.depth = depth;
  }

  record(clientTick: number, serverTick: number, yawHundredths: number, pitchHundredths: number): void {
    this.ring.push({ clientTick, serverTick, yawHundredths, pitchHundredths });
    if (this.ring.length > this.depth) this.ring.shift();
  }

  /** Newest observed pose at or before the requested client tick. */
  atOrBefore(clientTick: number): { serverTick: number; yawHundredths: number; pitchHundredths: number } | null {
    let best: { clientTick: number; serverTick: number; yawHundredths: number; pitchHundredths: number } | null = null;
    for (const e of this.ring) {
      if (e.clientTick > clientTick) continue;
      if (best === null || e.clientTick > best.clientTick) best = e;
    }
    return best ? { serverTick: best.serverTick, yawHundredths: best.yawHundredths, pitchHundredths: best.pitchHundredths } : null;
  }

  /** The most recently observed client tick (future-tick detection). */
  newestClientTick(): number | null {
    let newest: number | null = null;
    for (const e of this.ring) if (newest === null || e.clientTick > newest) newest = e.clientTick;
    return newest;
  }

  /** Last observed yaw/pitch (impossible aim-delta detection, T19). */
  last(): AimPose | null {
    return this.ring.length > 0 ? { yawHundredths: this.ring[this.ring.length - 1]!.yawHundredths, pitchHundredths: this.ring[this.ring.length - 1]!.pitchHundredths } : null;
  }
}
