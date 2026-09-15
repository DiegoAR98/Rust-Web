# M2: survival loop, inventory, identity

## Status: COMPLETE (2026-09-15)

GDD milestone 2: *players can gather, move, die, loot and reconnect without
duplication.* This milestone added the M2 simulation systems, the ECDSA
P-256 identity handshake (GDD §22.4), M2 replication, persistence wiring and
the browser client (nodes, inventory UI, interact, death overlay).

## Gates and evidence

| Gate | Evidence |
| --- | --- |
| Node catalog + tuning + despawn timers | `packages/content` 6 node types / 11 placements, 43 tuning keys; `despawnSeconds` per item |
| Inventory (36-slot, payload-aware, atomic) | `packages/sim/src/inventory.ts` + 19 tests: merge only on itemId+payload match, atomic moves, 255 stack cap |
| Gathering (tool multiplier gate, accumulator, 24-tick cooldown, seeded respawn) | `packages/sim/src/gathering.ts` + `worldgen.placeWorldNodes`; 12 tests |
| Death / corpse / respawn | `packages/sim/src/death.ts` `commitDeath` (single Class-A atomic transaction), `respawnPlayer` grants a fresh starter kit; tick applies survival to ALL live players |
| Pickup / loot / drop + ground merge (≤1.5 m same item+payload, 400-stack cap, catalog despawn) | `packages/sim/src/pickup.ts` + tests |
| Tick command dispatch + system order | `packages/sim/src/tick.ts` (move/equip/drop/pickup) + `tick-m2.test.ts` integration |
| Protocol wire schemas | `packages/protocol`: M2 commands, `ItemStackSchema`, `SpawnRecordSchema` (corpse/ground_item, inventory, equipment, vitals), identity handshake schemas; 14 tests |
| ECDSA P-256 identity handshake (§22.4) | `apps/server/src/identity.ts` + `host.ts` (challenge → identity → grant → baseline → ready); PlayerId = SHA-256(serverId + canonical JWK); 24-hour HMAC session tokens; 5-minute reconnect; duplicate identity supersedes the older socket |
| World autosave + load-on-boot | `apps/server` wires `WorldRepository`: autosave every 5 min (15 000 ticks) + after every death transaction, commit on clean shutdown; `host.restoreFromSave` on boot; migration `0002_m2_entity_payload` |
| Browser client | `apps/client`: `identity.ts` (IndexedDB P-256 persistence + raw→DER per ADR-0006), `net.ts` (handshake + baseline ack), Three.js world (nodes, corpses, ground items), 36-slot inventory UI + hotbar, E/F interact, death overlay + respawn |

## Exit-gate evidence ("gather, move, die, loot and reconnect without duplication")

- `tools/smoke` `m2-gate` (Node WS client, real host with `DUSTFALL_DEV_KILL=1`):
  gather 2 wood, moveItem to equip, drop+loot round-trip, forced death →
  corpse holds exactly the carried stack, reconnect under the same
  PlayerId, loot the corpse — **no item duplication, no loss beyond the
  fresh starter kit granted on respawn (conservation invariant asserted)**.
  PASS 2026-09-15.
- `tools/smoke` `browser-load` (Playwright, real browser → real host):
  handshake, baseline, live HUD tick/pos/health, **movement reaches the
  authoritative sim** (position delta observed). PASS 2026-09-15.
- `apps/server` `e2e-m2-client.ts` (tsx, headless full walk of the wire
  protocol incl. reconnect under a new key pair — identity is per-key).
- `apps/server` `persist-m2.test.ts`: host → save → fresh host → restore
  (clock, loot, no id collision).
- 103 unit tests green (sim 61, server 22, persistence 6, protocol 14);
  all packages typecheck clean.

## Key decisions

- **Reconnect is a new socket, not a protocol step**: within 5 minutes the
  same identity re-authenticates; the host keeps the session record and the
  player body; a fresh key pair is a *different* PlayerId by design
  (PlayerId = SHA-256(serverId + JWK)).
- **Dev kill hook**: `POST /dev/kill?sessionId=…` (only with
  `DUSTFALL_DEV_KILL=1`) force-commits a death transaction so the "die" half
  of the exit gate is testable over the wire without waiting for starvation.
- **Replication**: full baseline on join (≤400 records; world is 288
  placements + players), 15 Hz deltas; per-session self-delta carries the
  owner's live inventory; `forget` records for entities removed from the
  store; events never dropped between batches (pending queue, §21.7).
- **Signature encoding**: ADR-0006 (browser raw → DER).

## Out of scope / deferred

- M3+: structures, crafting UI parity, PvP rules, AI two-hour soak (T12, M10).
- Rapier collision for movement/objects — M-1B spike proved the load path
  (ADR-0005); gameplay collision wiring is later.
