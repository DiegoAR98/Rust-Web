/**
 * SplitMix32 gameplay RNG (ADR-0002).
 * 32-bit state with uint32 arithmetic via Math.imul — fully deterministic
 * across all JS engines (no BigInt, no 64-bit float truncation ambiguity).
 * `Math.random()` is forbidden in packages/sim (GDD §21.5).
 */
export const SUBSYSTEM = {
  world: 0,
  loot: 1,
  nodeRespawn: 2,
  ai: 3,
  weather: 4,
  airdrop: 5,
} as const;
export type SubsystemId = (typeof SUBSYSTEM)[keyof typeof SUBSYSTEM];

const GOLDEN = 0x9e3779b9;

const u32 = (n: number): number => n >>> 0;

/** One SplitMix32 step. */
const mix = (state: number): { value: number; state: number } => {
  let z = u32(state + GOLDEN);
  z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
  z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
  z ^= z >>> 16;
  return { value: z >>> 0, state: z };
};

export class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = u32(seed);
  }

  /**
   * Derive an independent stream for a subsystem from the world seed.
   * The world seed is two uint32 words; they are folded with SplitMix
   * before the subsystem id is mixed in.
   */
  static derive(worldSeedA: number, worldSeedB: number, subsystem: SubsystemId): Rng {
    let s = u32(worldSeedA + Math.imul(worldSeedB, 0x85ebca6b));
    s = mix(s).value;
    s = Math.imul(s ^ u32(subsystem) * 0x27d4eb2f, 0xc2b2ae35);
    return new Rng(s);
  }

  /** Next uint32. */
  nextU32(): number {
    const r = mix(this.state);
    this.state = r.state;
    return r.value;
  }

  /** Uniform float in [0, 1). */
  nextFloat(): number {
    return this.nextU32() / 4294967296;
  }

  /** Integer in [0, n). */
  nextInt(n: number): number {
    if (n <= 0) return 0;
    return this.nextU32() % n;
  }

  /** Pick from a non-empty array. */
  pick<T>(arr: readonly T[]): T {
    const v = arr[this.nextInt(arr.length)];
    if (v === undefined) throw new Error("rng.pick on empty array");
    return v;
  }
}
