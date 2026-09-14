# ADR-0002: Gameplay RNG algorithm

## Status: accepted (2026-09-14)

## Context
GDD §21.5: gameplay RNG is a named seeded stream, one specified algorithm,
each subsystem owns a stream derived from `worldSeed + subsystemId`.
`Math.random()` is forbidden in `packages/sim`.

## Decision
Use SplitMix64 as the stream algorithm, with 64-bit state held as two
float64 halves in `Float64Array` for portability (no BigInt in hot paths).
Streams are keyed by `(worldSeed, subsystemId)` where both are Uint32
words; subsystem ids are a fixed enum in `packages/sim`.

## Consequences
All seeded tests use fixed seeds. A stream object is never shared across
subsystems or ticks.
