# M0: Monorepo, tooling, content schema

Status: COMPLETE (2026-09-14). Verified: `pnpm install && pnpm typecheck &&
pnpm test && pnpm content:validate` all green on a clean clone; headless
Chromium loads the client, connects and receives the baseline
(`tools/smoke/src/browser-load.mjs`).

## Scope (GDD §25 M0)
- pnpm workspace with the §21.3 layout and the §21.3 dependency direction.
- TypeScript strict config with `noUncheckedIndexedAccess` and
  `exactOptionalPropertyTypes` (locked baseline, §21.2).
- Vitest wired per package; a green test run on a clean clone.
- Content schema: item/recipe/building/region data with Zod-validated
  identifier conventions and a `content:validate` script.
- Dev server + client canvas placeholder that loads a blank session.

## Exit gate (GDD)
Clean install and browser loads a blank authenticated session.
