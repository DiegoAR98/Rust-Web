# ADR-0001: Node runtime pinned to 24.21.0

## Status: accepted (2026-09-14)

## Context
GDD §21.2 locks Node.js 24 LTS with the exact minor pinned in `.node-version`.
At M0 bootstrap the latest 24.x LTS release is 24.21.0.

## Decision
Pin `24.21.0` in `.node-version`. `package.json` engines enforce `>=24.21.0 <25.0.0`.
Upgrade only between milestones (GDD rule).

## Consequences
CI must install this exact minor. `node:sqlite` (M-1 prerequisite M-1B) must be
proven on this runtime on ARM64 before persistence work proceeds.
