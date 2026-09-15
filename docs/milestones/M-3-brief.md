# M-3: Crafting, Campfire, Furnace, Workbench, Blueprints

**Status:** COMPLETE (2026-09-15)
**Exit gate (GDD §25):** "First-session arc reaches shelter, furnace and bow" — **PASS** (`pnpm --filter @dustfall/smoke m3-gate`)

## Scope

GDD §9: one in-progress hand-craft per player; station crafts run at a placed
structure (one queue per station); outputs pay into the starter's grid or drop
at the station; blueprints are the only persistent progression (survive death,
belong to the world save); research at a Workbench (Research Kit + item →
payload learned permanently).

## Steps

### 1. Content: station conversions + bow + researchable items
- `packages/content/src/recipes.ts`: 6 M3 station conversions (campfire:
  cooked meats; furnace: metal fragments, sulfur, leather, charcoal) and the
  hunting bow (`recipe_hunting_bow`, hand: 3 wood + 1 stone + 1 cloth, 6 s).
  The GDD spine table omits the bow but the M3 exit gate requires it —
  authored as a default hand recipe, documented in a code comment.
- `items.ts`: `hatchet` marked `researchable` → `bp_pickaxe`.
- `blueprints.ts`: `bp_pickaxe` (research a Hatchet) + `bp_metal_building`
  (loot-only, the GDD canonical example).
- `validate-content.ts`: blueprint payload + researchable cross-checks.

### 2. Sim: crafting module
- `packages/sim/src/crafting.ts`: `startCraft` (hand + station, reach/
  affordability/queue/blueprint proofs, materials paid at start — no refund on
  death), `advanceCrafts` (completes on the tick after start+T), `research`,
  `placeStructure` (reach / min-spacing / per-player cap, item consumed).
- `entities.ts`: `PlayerEntity.craft`, `StructureEntity` (owner, hp, station
  craft queue).
- `tick.ts`: `craft`/`research`/`place` intents + `crafted`/`researched`/
  `placed` events; craft advancement as system step 8 (after the clock).
- `death.ts`: death clears the in-progress craft (no refund, GDD §9).
- 12 tests in `crafting.test.ts`.

### 3. Protocol: M3 wire schemas
- `envelope.ts`: `craft` / `research` / `place` intents.
- `snapshot.ts`: `structure` kindTag; player records carry `blueprints` (join)
  and `handCraft` (own spawn/delta); structure records carry `ownerId`/`hp`/
  `craft`.
- 2 new schema tests.

### 4. Server: host wiring
- `host.ts`: M3 intent mapping, structure replication (spawn on first sight,
  craft-state deltas via `structureSeen` diff), `craft`/`build`/`blueprint`
  events, hand-craft + blueprints on the player's own spawn/delta,
  structure + craft state persistence.
- 5 new host tests (hand craft, place, research, schema rejection, baseline
  with structures).

### 5. Persistence
- Migration `0003_m3_player_craft` (`players.craft_json`).
- `PlayerSave.craft`; structure payload `craft` (in-flight station craft
  survives a restart).
- 2 new persistence tests (structure + craft round-trip, blueprint
  round-trip).

### 6. Client
- `replica.ts`: `ReplicaStructure` map, structure spawn/delta/forget,
  per-player `blueprints` + `handCraft`.
- `net.ts`: M3 intents on the 30 Hz envelope.
- `main.ts`: crafting panel (C) — recipe list filtered by station reach +
  blueprint ownership, research button for locked recipes, craft progress bar
  (own hand-craft or nearest in-reach station); structure meshes per content
  type; placement mode (right-click a building/deployable → ghost follows the
  crosshair → left-click places, Esc cancels; the server proves reach/
  spacing/cap); craft/blueprint event toasts.
- `index.html`: `#craft` panel, `#placeHint`, `#ghost`.

### 7. Exit gate
- `tools/smoke/src/m3-gate.mjs`: one browser-style P-256 identity runs the
  first-session arc against a live host — gather 16 wood / 6 stone / 1 cloth
  (real nodes, real walk, real swing cooldowns) → craft + place a Furnace →
  craft + place a Wood Shelter → craft a Hunting Bow. Passes:
  `M3 GATE: PASS — first-session arc reaches shelter, furnace and bow`.

## Verification (all green)

- `pnpm -r test`: sim 77, protocol 17, content 4, persistence 6, server 29
  (133 total)
- `pnpm -r typecheck`: clean
- `pnpm content:validate`: 42 items, 20 recipes
- `m3-gate`: PASS (live host, fresh world)
- `m2-gate` + `two-clients`: still PASS (no regression)

## Deviations / notes

- **Bow authored as a hand recipe** (GDD spine omits it; exit gate requires
  it). Recorded in `recipes.ts` + here.
- **Research Kit has no authored source yet** (no loot table / recipe in M3
  content) — the research loop is fully implemented and unit-tested (host +
  sim) but is not part of the first-session arc; `bp_metal_building` remains
  the loot-only blueprint until M4+ content.
- **In-flight crafts survive restarts** (hand + station), unlike M2's
  decision to drop in-flight state: the GDD requires blueprint persistence and
  the save already stores the world clock, so a paused craft resumes on the
  correct tick.
