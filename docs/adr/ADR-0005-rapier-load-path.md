# ADR-0005: deterministic Rapier load path on the host

## Status: accepted (2026-09-14)

## Context
GDD §21 pins `@dimforge/rapier3d-deterministic` for the authoritative host.
The plain package (0.20.0, current on npm) ships two builds:

- Bundler-oriented class API: extensionless ESM imports, so Node cannot
  resolve the import chain without a bundler.
- A `rapier_wasm3d_bg.wasm` ES-module import that Node loads, but with a
  wasm-bindgen heap quirk under Node: after the first internal
  `performance.now()` timing call, a second call re-reads the same heap slot
  and invokes `.now()` on the number it just wrote, so `World.step` throws
  `TypeError: o.now is not a function`.

The package also publishes
`@dimforge/rapier3d-deterministic-compat`: the same deterministic build with
the WASM embedded as base64, an explicit `init()`, and proper `exports` for
both ESM and CJS. The GDD points at exactly this build ("wider bundler
support, does not require weakening the CSP").

## Decision
The host loads `@dimforge/rapier3d-deterministic-compat` (0.20.0) and awaits
its `init()` once before creating the `World`. No external `.wasm` file, no
bundler step, works in both Node (server) and any browser bundler (client
admin tools). `packages/physics` owns the dependency and will re-export the
`PhysicsPort` implementation; no other package may import `@dimforge/*`
directly (GDD §21.3 one-way dependency direction).

## Evidence
`tools/spike/rapier-node.mjs` (M-1B): 120-step free-fall simulation, 10
fixed-point trajectory samples, bit-for-bit identical across two
independent Node runs; ball settles at the slab surface without floor
penetration. `node:sqlite` verified available on the pinned runtime (Node
24.x, `DatabaseSync` in-memory + file persistence).

## Consequences
- `packages/physics` depends on the `-compat` package, not the plain one.
  If a future Rapier release fixes the Node heap quirk, re-evaluate and
  record a follow-up ADR.
- `init()` is async: host bootstrap must await it before the first tick.
- WASM is ~2 MB inlined per package instance; acceptable for a single
  authoritative host process.
