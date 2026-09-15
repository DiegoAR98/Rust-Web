/**
 * Gathering node catalog + seeded placement (GDD §7).
 *
 * Tool preference (GDD §7): a swing only contributes when the held tool's
 * toolMultiplier >= the node's minToolMultiplier. Rock (0.5) and Torch (0.5)
 * therefore work on trees/wood piles (min 0.5) and stone (min 0.5) but not
 * on ore (min 1). A swing with a matching tool adds its toolMultiplier to
 * the harvest accumulator; each whole unit pays out exactly one resource
 * unit — half-rate tools pay every second swing without rounding exploits.
 */
import type { NodeDef, NodePlacementDef } from "./schemas.js";

export const NODES: readonly NodeDef[] = [
  {
    id: "node_tree",
    kind: "tree",
    resourceItemId: "wood",
    pool: 8,
    respawnSeconds: 1800, // 30 game minutes
    minToolMultiplier: 0.5,
  },
  {
    id: "node_wood_pile",
    kind: "wood_pile",
    resourceItemId: "wood",
    pool: 6,
    respawnSeconds: 2400,
    minToolMultiplier: 0.5,
  },
  {
    id: "node_stone_rock",
    kind: "stone_rock",
    resourceItemId: "stone",
    pool: 6,
    respawnSeconds: 1800,
    minToolMultiplier: 0.5,
  },
  {
    id: "node_metal_ore",
    kind: "metal_ore",
    resourceItemId: "metal_ore",
    pool: 4,
    respawnSeconds: 3600, // 1 game hour
    minToolMultiplier: 1, // pickaxe tier only (GDD §7)
  },
  {
    id: "node_sulfur_ore",
    kind: "sulfur_ore",
    resourceItemId: "sulfur_ore",
    pool: 4,
    respawnSeconds: 3600,
    minToolMultiplier: 1,
  },
  {
    id: "node_animal_corpse",
    kind: "animal_corpse",
    resourceItemId: "raw_rabbit_meat",
    pool: 2,
    respawnSeconds: 0, // animal corpses do not respawn; wildlife does (M5)
    minToolMultiplier: 0.5,
    secondaries: [
      { itemId: "cloth", probability: 0.6 },
      { itemId: "animal_fat", probability: 0.4 },
      { itemId: "blood", probability: 0.1 },
    ],
  },
];

/**
 * Seeded placement. M2 vertical slice: the three M0 regions get their
 * authored resource mix. Positions are generated deterministically from
 * the world seed at host boot (sim worldgen), never from Math.random.
 */
export const NODE_PLACEMENTS: readonly NodePlacementDef[] = [
  // Bootheel Landing — safe landing: light timber and stone, a few corpses
  { nodeId: "node_tree", regionId: "region_bootheel_landing", count: 40, scatterM: 220, nearSpawn: true },
  { nodeId: "node_wood_pile", regionId: "region_bootheel_landing", count: 12, scatterM: 160, nearSpawn: true },
  { nodeId: "node_stone_rock", regionId: "region_bootheel_landing", count: 18, scatterM: 220, nearSpawn: true },
  { nodeId: "node_animal_corpse", regionId: "region_bootheel_landing", count: 6, scatterM: 180, nearSpawn: true },
  // Pinewatch — dense timber
  { nodeId: "node_tree", regionId: "region_pinewatch", count: 90, scatterM: 450 },
  { nodeId: "node_wood_pile", regionId: "region_pinewatch", count: 30, scatterM: 450 },
  { nodeId: "node_stone_rock", regionId: "region_pinewatch", count: 24, scatterM: 450 },
  { nodeId: "node_animal_corpse", regionId: "region_pinewatch", count: 12, scatterM: 450 },
  // Shalefield Mine — ore
  { nodeId: "node_metal_ore", regionId: "region_shalefield", count: 24, scatterM: 300 },
  { nodeId: "node_sulfur_ore", regionId: "region_shalefield", count: 20, scatterM: 300 },
  { nodeId: "node_stone_rock", regionId: "region_shalefield", count: 12, scatterM: 300 },
];

export const nodeById = (id: string): NodeDef | undefined => NODES.find((n) => n.id === id);
