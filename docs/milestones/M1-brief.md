# M1: Shared sim loop, player movement, camera, replica codec

Status: COMPLETE (2026-09-14). Verified: two headless clients share one
authoritative world — late joiner's baseline contains the first player's
replicated position with integer-cm wire records
(`tools/smoke/src/two-clients.mjs`); headless Chromium movement reaches the
server sim (`tools/smoke/src/browser-load.mjs`).

## Scope (GDD §25 M1)
- `packages/contracts`: branded EntityId/PlayerId, Vec3/Quat math structs,
  PhysicsPort interface, Vitals, ItemStack.
- `packages/sim`: fixed 30 Hz tick loop, tick order per §21.5, player
  movement (walk/sprint/crouch/jump, GDD §5 constants), vitals, seeded RNG.
- `packages/protocol`: versioned ClientEnvelope/Snapshot schemas, binary
  codec boundaries, command and event catalogs.
- `apps/server`: authoritative host, WebSocket gateway, 30 Hz loop, 15 Hz
  replica, spawn at Bootheel Landing, graceful shutdown.
- `apps/client`: pointer-lock movement, camera, replica store rendering a
  read-only world.

## Exit gate (GDD)
Two browser clients move in one authoritative world.
