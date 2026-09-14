/**
 * Deterministic fixtures for simulation tests (GDD §21.2).
 */
import { createWorld } from "@dustfall/sim";
import { EntityStore, newPlayer, runTick } from "@dustfall/sim";
import type { World } from "@dustfall/sim";
import type { EntityStore as Store } from "@dustfall/sim";

export const TEST_SEED_A = 0x12345678;
export const TEST_SEED_B = 0xabcdef00;
export const TEST_WORLD_ID = "test_world_001";

export const makeTestWorld = (): World =>
  createWorld(TEST_WORLD_ID, TEST_SEED_A, TEST_SEED_B);

export const makeTestStore = (): Store => new EntityStore();

export const makeTestPlayer = (store: Store, playerId: string, spawnX = 0, spawnZ = 0) => {
  const id = store.allocate();
  const p = newPlayer(id, playerId as import("@dustfall/contracts").PlayerId, { x: spawnX, y: 0, z: spawnZ });
  store.insert(p);
  return p;
};

/** Run N ticks with no commands. */
export const runTicks = (world: World, store: Store, n: number) => {
  
  for (let i = 0; i < n; i++) {
    runTick(world, store, []);
  }
};
