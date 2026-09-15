/**
 * World regions (GDD §14). M0 seeds the vertical slice:
 * Bootheel Landing, Pinewatch, Shalefield.
 */
import type { RadiationZoneDef } from "./schemas.js";

export interface RegionDef {
  id: string;
  name: string;
  /** 500 m authoring tile centers in meters */
  tiles: readonly { x: number; z: number }[];
  /** primary spawn beaches */
  spawnPoints: readonly { x: number; y: number; z: number }[];
  notes: string;
}

export const REGIONS: readonly RegionDef[] = [
  {
    id: "region_bootheel_landing",
    name: "Bootheel Landing",
    tiles: [{ x: -250, z: 250 }],
    spawnPoints: [
      { x: -150, y: 0, z: 380 },
      { x: -120, y: 0, z: 390 },
      { x: -90, y: 0, z: 370 },
    ],
    notes: "Spawn beaches, jetty, wreckage. Safest region.",
  },
  {
    id: "region_pinewatch",
    name: "Pinewatch",
    tiles: [{ x: 0, z: 0 }, { x: 250, z: 0 }],
    spawnPoints: [],
    notes: "Central pine forest and logging yard. Dense timber, deer, boar, wolves at night.",
  },
  {
    id: "region_shalefield",
    name: "Shalefield Mine",
    tiles: [{ x: -250, z: -250 }],
    spawnPoints: [],
    notes: "First low-radiation mining town. Metal and sulfur.",
  },
];

/** Four authored radiation zones (GDD §6/§15). Coordinates in meters. */
export const RADIATION_ZONES: readonly RadiationZoneDef[] = [
  {
    id: "region_shalefield",
    band: "low",
    rimRadiusM: 120,
    midRadiusM: 70,
    coreRadiusM: 30,
    center: { x: -250, y: 0, z: -250 },
  },
  {
    id: "region_greywater_plant",
    band: "extreme",
    rimRadiusM: 100,
    midRadiusM: 60,
    coreRadiusM: 25,
    center: { x: 250, y: 0, z: -250 },
  },
  {
    // M5: High band — needed for acceptance test T03 (High core naked = 5.0 rads/s).
    id: "region_ashfield_rad",
    band: "high",
    rimRadiusM: 90,
    midRadiusM: 50,
    coreRadiusM: 20,
    center: { x: -50, y: 0, z: -150 },
  },
  {
    // M5: a second low band for the northern basin edge.
    id: "region_north_rim",
    band: "low",
    rimRadiusM: 80,
    midRadiusM: 45,
    coreRadiusM: 18,
    center: { x: 150, y: 0, z: 250 },
  },
];

export const TICK_HZ = 30;
