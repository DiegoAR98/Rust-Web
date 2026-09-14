# ADR-0003: 30 Hz sim / 15 Hz replica

## Status: accepted (2026-09-14)

## Context
GDD §21.7 fixes simulation at 30 Hz and replica batches at exactly 15 Hz,
binary frames only after the JSON handshake, interest in at 200 m / out at
300 m.

## Decision
The server's tick scheduler emits a replica batch every second tick (tick % 2
== 1) and an in-baseline batch at join. Client input is accepted at 30 Hz.

## Consequences
Tests asserting wire cadence must use a fake clock (testkit).
