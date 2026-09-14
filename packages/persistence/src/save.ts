/**
 * World save schema, version 1 (GDD Appendix G / §21).
 *
 * `WorldSave` is the host's in-memory save document. The SQLite repository
 * (repository.ts) is the only place that persists it; JSON export/import is
 * a debug/backup side channel, not the live write path.
 */
import type { ItemStack, Vec3, Vitals } from "@dustfall/contracts";

export interface PlayerSave {
  playerId: string;
  blueprints: string[];
  inventory: (ItemStack | null)[];
  equipment: Record<string, ItemStack | null>;
  position: Vec3;
  vitals: Vitals;
  lastSeenTick: number;
}

export interface EntitySave {
  entityId: string;
  kind: "world" | "corpse" | "ground_item" | "structure";
  contentId: string;
  position: Vec3;
  pool: number;
}

export interface WorldSave {
  schemaVersion: number;
  worldId: string;
  seed: string;
  serverSettings: Record<string, unknown>;
  clock: { tick: number; gameSeconds: number; weather: string; weatherSeed: number };
  players: PlayerSave[];
  entities: EntitySave[];
  crews: unknown[];
  lootState: unknown[];
  migrationsApplied: string[];
  lastSavedAt: string;
}

export const SCHEMA_VERSION = 1;
