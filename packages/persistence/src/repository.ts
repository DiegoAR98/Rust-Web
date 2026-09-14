/**
 * SQLite world repository (GDD §21).
 *
 * Runs on `node:sqlite` (DatabaseSync) — Node 24 built-in, no native build
 * step, proven on ARM64 in M-1B.
 *
 * Guarantees this module owns:
 *  - journal_mode=WAL, foreign_keys=ON, synchronous=FULL, busy_timeout=5000
 *  - schema migrations run in a single transaction at open; a failed
 *    migration leaves the previous database untouched (BEGIN/ROLLBACK)
 *  - `save()` is atomic: the full world is staged into the staging tables
 *    first, verified, then committed in one transaction ("write to a
 *    transaction table first, then commit" — GDD §21)
 *  - clean shutdown: WAL checkpoint (TRUNCATE) so the .db file alone is
 *    a consistent snapshot
 *  - backups: keep the last three clean-shutdown copies (GDD §21)
 */
import { DatabaseSync } from "node:sqlite";
import { copyFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { SCHEMA_VERSION, type WorldSave, type PlayerSave, type EntitySave } from "./save.js";

const MIGRATIONS = [
  {
    id: "0001_initial",
    up: `
      CREATE TABLE meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE players (
        player_id TEXT PRIMARY KEY,
        position_json TEXT NOT NULL,
        vitals_json TEXT NOT NULL,
        last_seen_tick INTEGER NOT NULL,
        blueprints_json TEXT NOT NULL,
        equipment_json TEXT NOT NULL
      );
      CREATE TABLE player_inventory (
        player_id TEXT NOT NULL REFERENCES players(player_id) ON DELETE CASCADE,
        slot INTEGER NOT NULL,
        item_id TEXT NOT NULL,
        quantity INTEGER NOT NULL,
        payload TEXT,
        PRIMARY KEY (player_id, slot)
      );
      CREATE TABLE entities (
        entity_id TEXT PRIMARY KEY,
        kind TEXT NOT NULL CHECK (kind IN ('world','corpse','ground_item','structure')),
        content_id TEXT NOT NULL,
        position_json TEXT NOT NULL,
        pool INTEGER NOT NULL
      );
      CREATE TABLE save_journal (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        saved_at TEXT NOT NULL,
        tick INTEGER NOT NULL
      );
      -- Staging tables used by save(): a full world is written here, verified,
      -- then swapped into the live tables inside one transaction.
      CREATE TABLE staging_players (
        player_id TEXT PRIMARY KEY,
        position_json TEXT NOT NULL,
        vitals_json TEXT NOT NULL,
        last_seen_tick INTEGER NOT NULL,
        blueprints_json TEXT NOT NULL,
        equipment_json TEXT NOT NULL
      );
      CREATE TABLE staging_player_inventory (
        player_id TEXT NOT NULL REFERENCES staging_players(player_id) ON DELETE CASCADE,
        slot INTEGER NOT NULL,
        item_id TEXT NOT NULL,
        quantity INTEGER NOT NULL,
        payload TEXT,
        PRIMARY KEY (player_id, slot)
      );
      CREATE TABLE staging_entities (
        entity_id TEXT PRIMARY KEY,
        kind TEXT NOT NULL CHECK (kind IN ('world','corpse','ground_item','structure')),
        content_id TEXT NOT NULL,
        position_json TEXT NOT NULL,
        pool INTEGER NOT NULL
      );
    `,
  },
];

export class WorldRepository {
  private db: DatabaseSync;
  private readonly file: string;
  /** The world file without its `.db` extension (backup-name prefix). */
  private readonly base: string;

  /** Open (or create + migrate) the world database at `file`. */
  constructor(file: string) {
    this.file = file;
    this.base = basename(file).replace(/\.db$/, "");
    mkdirSync(dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec("PRAGMA journal_mode=WAL;");
    this.db.exec("PRAGMA foreign_keys=ON;");
    this.db.exec("PRAGMA synchronous=FULL;");
    this.db.exec("PRAGMA busy_timeout=5000;");
    this.runMigrations();
  }

  /**
   * Migrations: each applies in its own transaction. A failed migration rolls
   * back so the previous schema stays intact, and the error is propagated so
   * the host refuses to start (GDD §21: "prevents hosting").
   */
  private runMigrations(): void {
    this.db.exec(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         id TEXT PRIMARY KEY,
         applied_at TEXT NOT NULL
       )`,
    );
    for (const m of MIGRATIONS) {
      const row = this.db
        .prepare("SELECT 1 FROM schema_migrations WHERE id = ?")
        .get(m.id);
      if (row) continue;
      this.db.exec("BEGIN IMMEDIATE;");
      try {
        this.db.exec(m.up);
        this.db
          .prepare("INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)")
          .run(m.id, new Date().toISOString());
        this.db.exec("COMMIT;");
      } catch (err) {
        this.db.exec("ROLLBACK;");
        throw new Error(
          `migration ${m.id} failed; database left untouched: ${(err as Error).message}`,
        );
      }
    }
  }

  private appliedMigrations(): string[] {
    return (
      this.db
        .prepare("SELECT id FROM schema_migrations ORDER BY id")
        .all()
        .map((r) => String(r["id"]))
    );
  }

  /**
   * Atomically persist the whole world.
   * 1) stage every row in the staging tables (inside a transaction)
   * 2) verify row counts against the in-memory document
   * 3) swap staging -> live in the same transaction, append the journal
   */
  save(doc: WorldSave): void {
    if (doc.schemaVersion !== SCHEMA_VERSION) {
      throw new Error(`unsupported save schema version ${doc.schemaVersion}`);
    }
    this.db.exec("BEGIN IMMEDIATE;");
    try {
      this.db.exec("DELETE FROM staging_players; DELETE FROM staging_player_inventory; DELETE FROM staging_entities;");

      const sp = this.db.prepare(
        "INSERT INTO staging_players (player_id, position_json, vitals_json, last_seen_tick, blueprints_json, equipment_json) VALUES (?, ?, ?, ?, ?, ?)",
      );
      const si = this.db.prepare(
        "INSERT INTO staging_player_inventory (player_id, slot, item_id, quantity, payload) VALUES (?, ?, ?, ?, ?)",
      );
      const se = this.db.prepare(
        "INSERT INTO staging_entities (entity_id, kind, content_id, position_json, pool) VALUES (?, ?, ?, ?, ?)",
      );

      for (const p of doc.players) {
        sp.run(p.playerId, JSON.stringify(p.position), JSON.stringify(p.vitals), p.lastSeenTick, JSON.stringify(p.blueprints), JSON.stringify(p.equipment));
        for (let slot = 0; slot < p.inventory.length; slot++) {
          const stack = p.inventory[slot];
          if (stack) si.run(p.playerId, slot, stack.itemId, stack.quantity, stack.payload ?? null);
        }
      }
      for (const e of doc.entities) {
        se.run(e.entityId, e.kind, e.contentId, JSON.stringify(e.position), e.pool);
      }

      // Verify the staging tables before touching live data.
      const stagedPlayers = Number((this.db.prepare("SELECT COUNT(*) c FROM staging_players").get() as Record<string, unknown> | undefined)?.["c"] ?? 0);
      const stagedEntities = Number((this.db.prepare("SELECT COUNT(*) c FROM staging_entities").get() as Record<string, unknown> | undefined)?.["c"] ?? 0);
      if (stagedPlayers !== doc.players.length || stagedEntities !== doc.entities.length) {
        throw new Error(
          `staging verification failed: players ${stagedPlayers}/${doc.players.length}, entities ${stagedEntities}/${doc.entities.length}`,
        );
      }

      // Swap.
      this.db.exec("DELETE FROM player_inventory; DELETE FROM players; DELETE FROM entities;");
      this.db.exec("INSERT INTO players SELECT * FROM staging_players;");
      this.db.exec("INSERT INTO player_inventory SELECT * FROM staging_player_inventory;");
      this.db.exec("INSERT INTO entities SELECT * FROM staging_entities;");

      this.db.prepare("INSERT INTO meta (key, value) VALUES ('world_id', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(doc.worldId);
      this.db.prepare("INSERT INTO meta (key, value) VALUES ('seed', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(doc.seed);
      this.db.prepare("INSERT INTO meta (key, value) VALUES ('clock', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify(doc.clock));
      this.db.prepare("INSERT INTO meta (key, value) VALUES ('server_settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify(doc.serverSettings));
      this.db.prepare("INSERT INTO meta (key, value) VALUES ('crews', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify(doc.crews));
      this.db.prepare("INSERT INTO meta (key, value) VALUES ('loot_state', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify(doc.lootState));

      this.db
        .prepare("INSERT INTO save_journal (saved_at, tick) VALUES (?, ?)")
        .run(doc.lastSavedAt, doc.clock.tick);

      this.db.exec("COMMIT;");
    } catch (err) {
      this.db.exec("ROLLBACK;");
      throw err;
    }
  }

  /** Load the last committed world. Returns null when no save exists yet. */
  load(): WorldSave | null {
    const meta = new Map<string, string>();
    for (const row of this.db.prepare("SELECT key, value FROM meta").all()) {
      meta.set(String(row["key"]), String(row["value"]));
    }
    if (!meta.has("world_id")) return null;

    const players = this.db
      .prepare(
        `SELECT p.player_id, p.position_json, p.vitals_json, p.last_seen_tick, p.blueprints_json, p.equipment_json,
                (SELECT json_group_array(json_object('slot', slot, 'itemId', item_id, 'quantity', quantity, 'payload', payload))
                 FROM player_inventory
                 WHERE player_id = p.player_id
                 ORDER BY slot) AS stacks
         FROM players p ORDER BY p.player_id`,
      )
      .all()
      .map((r): PlayerSave => {
        const p: PlayerSave = {
          playerId: String(r["player_id"]),
          position: JSON.parse(String(r["position_json"])),
          vitals: JSON.parse(String(r["vitals_json"])),
          lastSeenTick: Number(r["last_seen_tick"]),
          blueprints: JSON.parse(String(r["blueprints_json"])),
          equipment: JSON.parse(String(r["equipment_json"])),
          inventory: Array.from({ length: 36 }, () => null),
        };
        const stacks: Array<{ slot: number; itemId: string; quantity: number; payload: string | null }> = JSON.parse(String(r["stacks"] ?? "[]"));
        for (const s of stacks) {
          p.inventory[s.slot] = { itemId: s.itemId as never, quantity: s.quantity, ...(s.payload ? { payload: s.payload as never } : {}) };
        }
        return p;
      });

    const entities: EntitySave[] = this.db
      .prepare("SELECT entity_id, kind, content_id, position_json, pool FROM entities ORDER BY entity_id")
      .all()
      .map((r) => ({
        entityId: String(r["entity_id"]),
        kind: String(r["kind"]) as EntitySave["kind"],
        contentId: String(r["content_id"]),
        position: JSON.parse(String(r["position_json"])),
        pool: Number(r["pool"]),
      }));

    return {
      schemaVersion: SCHEMA_VERSION,
      worldId: meta.get("world_id")!,
      seed: meta.get("seed")!,
      serverSettings: JSON.parse(meta.get("server_settings") ?? "{}"),
      clock: JSON.parse(meta.get("clock") ?? "{}"),
      players,
      entities,
      crews: JSON.parse(meta.get("crews") ?? "[]"),
      lootState: JSON.parse(meta.get("loot_state") ?? "[]"),
      migrationsApplied: this.appliedMigrations(),
      lastSavedAt: String((this.db.prepare("SELECT MAX(saved_at) m FROM save_journal").get() as Record<string, unknown> | undefined)?.["m"] ?? ""),
    };
  }

  /** Clean shutdown: checkpoint the WAL into the main file, then close. */
  close(): void {
    this.db.exec("PRAGMA wal_checkpoint(TRUNCATE);");
    this.db.close();
  }

  /**
   * Keep the last three clean-shutdown backups next to the world file
   * (GDD §21). Backups are named `<base>.bak-NNNNNN.db` with a
   * monotonically-increasing sequence so same-millisecond calls stay
   * distinct. Returns the new backup's path.
   */
  backup(): string {
    const dir = dirname(this.file);
    const prefix = this.base + ".bak-";
    const suffix = ".db";
    const existing = readdirSync(dir)
      .filter((f) => f.startsWith(prefix) && f.endsWith(suffix))
      .map((f) => Number(f.slice(prefix.length, -suffix.length)))
      .filter(Number.isInteger);
    const seq = (existing.length > 0 ? Math.max(...existing) : 0) + 1;
    const dest = join(dir, `${prefix}${String(seq).padStart(6, "0")}${suffix}`);
    this.db.exec("PRAGMA wal_checkpoint(TRUNCATE);");
    copyFileSync(this.file, dest);
    const backups = readdirSync(dir)
      .filter((f) => f.startsWith(prefix) && f.endsWith(suffix))
      .sort()
      .reverse();
    for (const stale of backups.slice(3)) unlinkSync(join(dir, stale));
    return dest;
  }

  /** Path of the most recent backup, if any (used by crash-recovery tooling). */
  latestBackup(): string | null {
    const dir = dirname(this.file);
    const prefix = this.base + ".bak-";
    const found = readdirSync(dir)
      .filter((f) => f.startsWith(prefix) && f.endsWith(".db"))
      .sort()
      .reverse();
    const newest = found[0];
    return newest ? join(dir, newest) : null;
  }

  hasWorld(): boolean {
    return existsSync(this.file) && this.db.prepare("SELECT 1 FROM meta WHERE key='world_id'").get() !== undefined;
  }
}
