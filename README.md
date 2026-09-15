# Frontier Legacy: Dustfall

Browser-first western survival game. Desktop browsers (WebGL2) render the world;
an authoritative Node.js host owns all outcomes and persists the world in local SQLite.

See `Frontier Legacy Web - GDD.md` for the full design (v1.1).

## Layout (GDD §21.3)

```
apps/client         Vite browser client (Three.js / WebGL2)
apps/server         authoritative host process
apps/admin-cli      localhost-only host administration
packages/contracts  branded ids, math structs, content/wire/save DTOs
packages/sim        fixed-tick simulation, rules and components (engine-free)
packages/protocol   schemas, codecs, commands and events
packages/content    item/recipe/region data
packages/physics    Rapier implementation of the physics-port contract
packages/persistence SQLite repositories, migrations and backup code
packages/testkit    deterministic fixtures and fake clients
tools/              validators, asset pipeline, soak and packet inspection
docs/adr            architecture decisions; one file per decision
docs/milestones     current and completed milestone briefs
```

## Status

- [x] M0 - monorepo, tooling, content schema (verified 2026-09-14)
- [x] M1 - shared sim loop, player movement, camera, replica codec (verified 2026-09-14)
- [x] M-1B - browser/server spike: deterministic Rapier in Node (ADR-0005), node:sqlite world persistence + recovery, two-client gates (verified 2026-09-14, docs/milestones/M-1B-brief.md)
- [x] M2 - survival loop: gathering, 36-slot inventory, death/corpse/respawn, pickup/loot/drop, ECDSA P-256 identity handshake (§22.4, ADR-0006), world autosave/load-on-boot, browser client with inventory UI (verified 2026-09-15, docs/milestones/M-2-brief.md)
- [x] M3 - crafting: hand + station crafts (furnace/campfire/workbench), structure placement, blueprints + research, crafting UI, in-flight craft persistence (verified 2026-09-15, docs/milestones/M-3-brief.md)
- [x] M4 - building grid, doors, storage, decay and sleeping bags (§10): wall/door/barricade pieces, melee breach (tool multiplier × 25), shared storage boxes, structure integrity + decay with owner refresh, destruction drops everything (nothing lost), two-player build+breach exit gate (verified 2026-09-15, docs/milestones/M-4-brief.md)
- [ ] M5+ - see GDD §25 production roadmap

## Development

```sh
pnpm install            # pnpm 10, Node 24 (pinned in .node-version)
pnpm typecheck          # strict TS across all packages
pnpm test               # vitest: clock T01/T02, movement, vitals, determinism, host, schemas, content
pnpm content:validate   # GDD §24 content catalog validation
pnpm dev:server         # authoritative host on :3000 (ws + /health)
pnpm dev:client         # Vite client on :5173 -> open http://localhost:5173
```

M1 exit gate (two clients in one authoritative world):

```sh
pnpm dev:server   # then, in another shell:
node tools/smoke/src/two-clients.mjs   # late joiner sees the first player's replicated position
node tools/smoke/src/browser-load.mjs  # headless Chromium: load -> connect -> move -> replica
```

M2 exit gate (gather, move, die, loot and reconnect without duplication):

```sh
DUSTFALL_DEV_KILL=1 pnpm dev:server   # enables the POST /dev/kill smoke hook
node tools/smoke/src/m2-gate.mjs       # full M2 loop over the wire (handshake -> gather -> move -> die -> reconnect -> loot)
```

M3 exit gate (first-session arc reaches shelter, furnace and bow):

```sh
DUSTFALL_DATA_DIR=$(mktemp -d) pnpm dev:server   # fresh world
node tools/smoke/src/m3-gate.mjs                 # ~2 min: gather → build → craft
```

M4 exit gate (two players build and breach the same test base):

```sh
DUSTFALL_DATA_DIR=$(mktemp -d) DUSTFALL_DEV_KILL=1 pnpm dev:server
node tools/smoke/src/m4-gate.mjs                 # P1 builds the base, P2 joins,
                                                 # withdraws the shared stash,
                                                 # places on the base, breaches
                                                 # P1's shelter to destruction
```

Known deviations from the GDD literal are recorded in `docs/adr/`
(notably ADR-0004: 24× game clock; ADR-0006: browser raw→DER ECDSA
signatures).
