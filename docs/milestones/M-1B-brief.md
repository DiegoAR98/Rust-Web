# M-1B: browser/server spike

## Status: COMPLETE (2026-09-14)

GDD §21 milestone 2: *prove two browser clients, the deterministic Rapier
build, the 30 Hz server tick, the 15 Hz replica stream and SQLite recovery on
the Spark before gameplay work begins.*

## Gates and evidence

| Gate | Evidence |
| --- | --- |
| Two browser clients | `tools/smoke` `two-clients` (WS, Node clients) + `browser-load` (Playwright headless Chromium: connect, baseline, live HUD tick/pos/health) — PASS, 2026-09-14 |
| 30 Hz server tick | `apps/server` `Host` + tick tests (`packages/sim` T01: 30 ticks = 1 real second, ADR-0004) |
| 15 Hz replica stream | ADR-0003; cadence asserted in `apps/server` host tests |
| Deterministic Rapier in the Node host | `tools/spike/rapier-node.mjs`: `@dimforge/rapier3d-deterministic-compat` 0.20.0, 120-step free-fall, 10 fixed-point samples, bit-for-bit identical across two independent runs. Load path recorded in ADR-0005. |
| SQLite recovery | `packages/persistence` `WorldRepository` (`node:sqlite`): WAL, FK ON, sync FULL, 5 s busy timeout; one-transaction migrations; atomic staged save; last-3 backup retention; WAL checkpoint on close. Six vitest cases incl. T08 (reconnect restores the saved player without duplicating inventory) — PASS |

## Out of scope for this milestone (deferred)

- Binding `WorldRepository` into `apps/server` (autosave timer, clean-shutdown
  hook) — lands with M2.
- Player identity / ECDSA P-256 (GDD §21.11) — lands with M2 auth.
- 8-client + AI two-hour soak (T12) — M10 stabilization.
