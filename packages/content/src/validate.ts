#!/usr/bin/env tsx
import { validateContent } from "./validate-content.js";

const result = validateContent();
if (result.failures.length > 0) {
  for (const f of result.failures) console.error(`[content] FAIL ${f}`);
  console.error(`[content] ${result.failures.length} validation failure(s)`);
  process.exit(1);
}
console.log(`[content] OK ${result.itemCount} items, ${result.recipeCount} recipes, ${result.radiationZoneCount} radiation zones, ${result.tuningKeyCount} tuning keys`);
