/**
 * Seeded world node placement (GDD §7 / §14).
 *
 * Positions are generated deterministically from the world seed via the
 * nodeRespawn subsystem RNG - the same seed always produces the same world
 * (T14 command-log replay relies on this). No Math.random anywhere.
 *
 * Scatter is a disc around the region anchor (first spawn point for
 * nearSpawn rows, otherwise the first tile center). Coordinates are stored
 * in integer cm, per the wire schema (GDD §21.5).
 */
import { NODE_PLACEMENTS, REGIONS, nodeById } from "@dustfall/content";
import type { EntityStore, WorldEntity } from "./entities.js";
import type { World } from "./world.js";
import { Rng, SUBSYSTEM } from "./rng.js";
import type { Vec3 } from "@dustfall/contracts";

const discPoint = (
  rng: Rng,
  anchor: { x: number; z: number },
  radiusM: number,
): { x: number; z: number } => {
  // square-rejection sampling for a uniform disc (deterministic, bounded)
  for (let i = 0; i < 32; i++) {
    const x = anchor.x + (rng.nextFloat() * 2 - 1) * radiusM;
    const z = anchor.z + (rng.nextFloat() * 2 - 1) * radiusM;
    const dx = x - anchor.x;
    const dz = z - anchor.z;
    if (dx * dx + dz * dz <= radiusM * radiusM) return { x, z };
  }
  return anchor;
};

/**
 * Place all authored nodes for the world. Idempotent: safe to call once at
 * host boot; a reloaded world reads its nodes from SQLite instead.
 */
export const placeWorldNodes = (world: World, store: EntityStore): number => {
  const rng = Rng.derive(world.seedA, world.seedB, SUBSYSTEM.nodeRespawn);
  let placed = 0;
  for (const pl of NODE_PLACEMENTS) {
    const region = REGIONS.find((r) => r.id === pl.regionId);
    if (!region) continue; // validated at content load; belt and braces
    const anchor = pl.nearSpawn
      ? region.spawnPoints[0]
      : region.tiles[0];
    if (!anchor) continue;
    for (let i = 0; i < pl.count; i++) {
      const pt = discPoint(rng, anchor, pl.scatterM);
      const pos: Vec3 = {
        x: Math.round(pt.x * 100),
        y: 0,
        z: Math.round(pt.z * 100),
      };
      const node: WorldEntity = {
        id: store.allocate(),
        kind: "world",
        contentId: pl.nodeId,
        position: pos,
        pool: 0, // set below from the catalog
        accumulator: 0,
        respawnAtTick: 0,
      };
      const def = nodeById(pl.nodeId);
      if (!def) continue;
      node.pool = def.pool;
      store.insert(node);
      placed += 1;
    }
  }
  return placed;
};
