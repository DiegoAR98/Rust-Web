# M-4: Building grid, doors, storage, decay, sleeping bags

**Status:** COMPLETE (2026-09-15)
**Exit gate (GDD §25):** "Two players build and breach the same test base" — **PASS** (`pnpm --filter @dustfall/smoke m4-gate` against a dev server with `DUSTFALL_DEV_KILL=1`: P1 builds shelter+2 walls+storage box and stashes wood, P2 joins, withdraws the shared stash, places a barricade on the same base, then breaches P1's shelter with a hatchet until `structure_destroyed` + forget + the body drops to the ground — nothing lost, GDD §21.5).

## Steps

1. **content: M4 building schema** — `buildingSchema` gains `breach` (`melee` | `explosive_only` | `immune`), `storageSlots`, `restable`; `damageImmune` kept for the M3 legacy flag. New pieces: `wood_wall` (800 hp, melee, 10 d decay), `wood_door` (500, melee), `wood_barricade` (400, melee). Stations/storage stay `explosive_only` (breached by M6 charges, GDD §11: no swing penetrates a wall). Recipes: wall 6 wood/10 s, door 6 wood+1 fragment/15 s, barricade 4 wood/4 s. Tuning: `decay.step_fraction` (0.10), `decay.owner_refresh_m` (5 m). Content validate: 45 items, 23 recipes.
2. **sim: `structures.ts`** —
   - `attackStructure`: 3 m reach, swing cooldown shared with node gathering, integer damage `round(toolMultiplier × 25)` (hatchet 50, rock 13), breach-rule gate, cooldown charged even on immune pieces (the world moved on).
   - `destroyStructure`: storage contents + one copy of the piece drop at its position, entity removed — conservation (GDD §21.5).
   - `depositToStructure` / `withdrawFromStructure`: any live player within 3 m, owner-agnostic shared storage (M7 adds locks), stack merging against `stackMax`.
   - `restAtStructure`: sleeping-bag rest regens 1 hp (full sleep channel is M5).
   - `applyStructureDecay` (GDD §10): unattended structures lose `decay.step_fraction × maxHp` every `decayDays/10` game-day; owner within `decay.owner_refresh_m` refreshes the timer instead. 0 hp destroys like a breach.
3. **sim: `StructureEntity`** gains `maxHp`, `storage: (ItemStack|null)[]`, `lastMaintainedAtTick`. `placeStructure` initialises all of it (stamp `lastMaintainedAtTick` at placement).
4. **sim: tick wiring** — a swing now targets either a node or a structure (branch in the command loop); new `deposit` / `withdraw` / `rest` intents; decay runs as system step 8 (after crafts, before death checks); new `attacked` / `destroyed` TickEvents.
5. **protocol** — envelope: `deposit` / `withdraw` / `rest` commands. Snapshot: `structure_hit` / `structure_destroyed` events; structure spawn/delta records carry `maxHp` + `storage` (delta replaces the whole grid, bounded 24 slots).
6. **server: host** — M4 intent mapping; structure replica signature = `hp|storage|craft` (delta only on change, per `structureSeen`); destruction events emit `structure_destroyed` + `forget`; save/restore persists `storage` + `lastMaintainedAtTick` (payload JSON column, no new migration needed); `POST /dev/grant` dev hook (`devGrantItem`) gated by `DUSTFALL_DEV_KILL=1` for the gate.
7. **client** — `ReplicaStructure` tracks `maxHp` + `storage`; storage panel (E on a box: deposit/withdraw by click, live refresh from deltas); interact now resolves storage → rest → breach in priority order; structure integrity bars in the 3D view; wall/door/barricade meshes + correct base offsets.
8. **tests** — `packages/sim/test/structures.test.ts` (16): attack damage/cooldown/reach/breach-rule/no-tool/destruction-drop, deposit/withdraw/non-storage/reach/merge, rest valid/invalid, decay due/owner-refresh. Persist: structure state round-trip (hp, storage, maintenance tick). 149 unit tests green.
9. **smoke: `m4-gate.mjs`** — two P-256 identities; P1 places the base (shelter, 2 walls, storage box; all server-validated reach/spacing) and stashes 10 wood; P2 sees the base in its baseline, walks to the box, withdraws the wood, places a barricade on the same base, then breaches P1's shelter to destruction; conservation verified (body dropped + entity forgotten). PASS in ~40 s.

## Decisions

- **Walls are melee-breached in M4.** The GDD §10/§11 intent is that *sturdy* bases resist melee and fall to explosives (M6). For the M4 exit gate a second player must be able to "breach the same test base" with what exists in M4, so walls/doors/barricades are `breach: "melee"`, while furnaces/workbenches/storage boxes (the "sturdy core") stay `explosive_only` and are immune to every swing in the game so far. M6 introduces charges and flips walls to `explosive_only` if the GDD is read that way — the rule is per-item data, so that is a one-line content change.
- **Integer structure damage.** `round(toolMultiplier × 25)` keeps `hp` integral (wire schema + persistence stay clean); the 0.5× rock deals 13, the 2.0× hatchet 50.
- **Storage deltas replace the whole grid.** ≤24 slots, one bounded payload — simpler than per-slot diffs, matches how the player inventory already rides the wire.
- **Decay runs in sim, not host.** Deterministic and covered by unit tests; the host only forwards `destroyed` ids as events + forgets.

## Verification

- 149 unit tests (sim 93, server 30, protocol 17, persistence 6, content 4) — all pass.
- `m4-gate` PASS (two clients, live world).
- Regression: `m3-gate` PASS, `m2-gate` PASS, `two-clients` PASS (post-M4 run).
- Typecheck clean across the repo (sim pre-existing TS2209 noise aside).
