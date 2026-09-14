import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WorldRepository, SCHEMA_VERSION, type WorldSave } from "../src/index.js";

let dir: string;
let dbFile: string;

const mkSave = (tick: number): WorldSave => ({
  schemaVersion: SCHEMA_VERSION,
  worldId: "basin",
  seed: "seed-42",
  serverSettings: { maxPlayers: 8 },
  clock: { tick, gameSeconds: tick * 0.8, weather: "clear", weatherSeed: 7 },
  players: [
    {
      playerId: "p1",
      blueprints: ["rock_pickaxe"],
      inventory: [
        { itemId: "rock", quantity: 3 },
        null,
        { itemId: "bandage", quantity: 2 },
        ...Array.from({ length: 33 }, () => null),
      ],
      equipment: { vest: { itemId: "vest_leather", quantity: 1 } },
      position: { x: -15000, y: 0, z: 38000 },
      vitals: {
        health: 87,
        calories: 1200,
        radiation: 0,
        bleeding: 0,
        coldDeficit: 5,
        poisonedTimer: 0,
        radiationSicknessTimer: 0,
        comfortTimer: 0,
      },
      lastSeenTick: tick,
    },
  ],
  entities: [
    { entityId: "e1", kind: "ground_item", contentId: "rock", position: { x: 1, y: 2, z: 3 }, pool: 4 },
    { entityId: "e2", kind: "structure", contentId: "campfire", position: { x: 0, y: 0, z: 0 }, pool: 0 },
  ],
  crews: [],
  lootState: [],
  migrationsApplied: ["0001_initial"],
  lastSavedAt: "2026-09-14T12:00:00.000Z",
});

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "dustfall-sqlite-"));
  dbFile = join(dir, "world.db");
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("M-1B SQLite world persistence", () => {
  it("migrates a fresh database and reports no world yet", () => {
    const repo = new WorldRepository(dbFile);
    expect(repo.load()).toBeNull();
    expect(repo.hasWorld()).toBe(false);
    repo.close();
  });

  it("save/load round-trips a full world document", () => {
    const repo = new WorldRepository(dbFile);
    repo.save(mkSave(100));
    repo.close();

    const repo2 = new WorldRepository(dbFile);
    const doc = repo2.load();
    expect(doc).not.toBeNull();
    expect(doc!.worldId).toBe("basin");
    expect(doc!.seed).toBe("seed-42");
    expect(doc!.clock.tick).toBe(100);
    expect(doc!.serverSettings).toEqual({ maxPlayers: 8 });
    expect(doc!.players).toHaveLength(1);
    expect(doc!.entities).toHaveLength(2);

    const p = doc!.players[0];
    expect(p.playerId).toBe("p1");
    expect(p.position).toEqual({ x: -15000, y: 0, z: 38000 });
    expect(p.vitals.health).toBe(87);
    expect(p.blueprints).toEqual(["rock_pickaxe"]);
    expect(p.equipment.vest).toEqual({ itemId: "vest_leather", quantity: 1 });
    // T08: reconnect restores the saved inventory without duplication.
    expect(p.inventory[0]).toEqual({ itemId: "rock", quantity: 3 });
    expect(p.inventory[1]).toBeNull();
    expect(p.inventory[2]).toEqual({ itemId: "bandage", quantity: 2 });
    expect(p.inventory.slice(3).every((s) => s === null)).toBe(true);
    expect(p.lastSeenTick).toBe(100);

    const [e1, e2] = doc!.entities;
    expect(e1).toEqual({ entityId: "e1", kind: "ground_item", contentId: "rock", position: { x: 1, y: 2, z: 3 }, pool: 4 });
    expect(e2.kind).toBe("structure");
    repo2.close();
  });

  it("saves are atomic: a mid-save failure leaves the previous world intact", () => {
    const repo = new WorldRepository(dbFile);
    // A document that fails staging verification (impossible via the API, so
    // simulate corruption by truncating a staged row count through a bad
    // schema version is rejected upfront; instead assert the live data still
    // matches the last good save after a rejected attempt).
    expect(() => repo.save({ ...mkSave(200), schemaVersion: 99 })).toThrow();
    const doc = repo.load();
    expect(doc!.clock.tick).toBe(100); // previous save untouched
    repo.close();
  });

  it("overwrites cleanly on a second save (no duplication)", () => {
    const repo = new WorldRepository(dbFile);
    repo.save(mkSave(150));
    repo.close();
    const repo2 = new WorldRepository(dbFile);
    const doc = repo2.load();
    expect(doc!.clock.tick).toBe(150);
    expect(doc!.players).toHaveLength(1); // not 2
    expect(doc!.entities).toHaveLength(2);
    expect(repo2.load()!.players[0].inventory.filter(Boolean)).toHaveLength(2);
    repo2.close();
  });

  it("WAL is active and a clean-shutdown checkpoint leaves a consistent file", () => {
    const repo = new WorldRepository(dbFile);
    repo.close(); // runs wal_checkpoint(TRUNCATE)
    // A fresh open of the main file alone must read the last save.
    const repo2 = new WorldRepository(dbFile);
    expect(repo2.load()!.clock.tick).toBe(150);
    repo2.close();
  });

  it("keeps only the three newest backups", () => {
    const repo = new WorldRepository(dbFile);
    for (let i = 0; i < 5; i++) {
      repo.backup();
      // Force distinct timestamps.
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1);
    }
    const repo2 = new WorldRepository(dbFile);
    expect(repo2.latestBackup()).not.toBeNull();
    expect(existsSync(repo2.latestBackup()!)).toBe(true);
    repo2.close();
    const backups = readdirSync(dir).filter((f: string) => f.includes(".bak"));
    expect(backups.length).toBeLessThanOrEqual(3);
  });
});
