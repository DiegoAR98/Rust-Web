/**
 * Content validator library (GDD §24). Called by validate.ts (CLI/CI) and tests.
 */
import { itemSchema, recipeSchema, radiationZoneSchema, tuningSchema, nodeSchema, nodePlacementSchema } from "./schemas.js";
import { ITEMS } from "./items.js";
import { RECIPES } from "./recipes.js";
import { NODES, NODE_PLACEMENTS } from "./nodes.js";
import { RADIATION_ZONES, REGIONS } from "./regions.js";
import { TUNING } from "./tuning.js";

export interface ContentValidation {
  failures: string[];
  itemCount: number;
  recipeCount: number;
  nodeCount: number;
  nodePlacementCount: number;
  radiationZoneCount: number;
  tuningKeyCount: number;
}

export const validateContent = (): ContentValidation => {
  const failures: string[] = [];
  const fail = (msg: string): void => {
    failures.push(msg);
  };

  const itemIds = new Set<string>();
  let itemCount = 0;
  for (const raw of ITEMS) {
    const r = itemSchema.safeParse(raw);
    if (!r.success) {
      fail(`item ${(raw as { id?: string }).id}: ${r.error.issues.map((i) => i.message).join("; ")}`);
      continue;
    }
    itemCount += 1;
    if (itemIds.has(r.data.id)) fail(`duplicate item id ${r.data.id}`);
    itemIds.add(r.data.id);
  }

  let recipeCount = 0;
  const recipeIds = new Set<string>();
  for (const raw of RECIPES) {
    const r = recipeSchema.safeParse(raw);
    if (!r.success) {
      fail(`recipe ${(raw as { id?: string }).id}: ${r.error.issues.map((i) => i.message).join("; ")}`);
      continue;
    }
    recipeCount += 1;
    const rec = r.data;
    if (recipeIds.has(rec.id)) fail(`duplicate recipe id ${rec.id}`);
    recipeIds.add(rec.id);
    if (rec.id !== `recipe_${rec.outputItemId}`) fail(`recipe ${rec.id} must be recipe_<output id>`);
    if (!itemIds.has(rec.outputItemId)) fail(`recipe ${rec.id} outputs unknown item ${rec.outputItemId}`);
    for (const inp of rec.inputs) {
      if (!itemIds.has(inp.itemId)) fail(`recipe ${rec.id} references unknown input ${inp.itemId}`);
    }
  }

  let radiationZoneCount = 0;
  for (const raw of RADIATION_ZONES) {
    const r = radiationZoneSchema.safeParse(raw);
    if (r.success) radiationZoneCount += 1;
    else fail(`radiation zone ${raw.id}: ${r.error.issues.map((i) => i.message).join("; ")}`);
  }

  const regionIds = new Set(REGIONS.map((r) => r.id));
  let nodeCount = 0;
  const nodeIds = new Set<string>();
  for (const raw of NODES) {
    const r = nodeSchema.safeParse(raw);
    if (!r.success) {
      fail(`node ${raw.id}: ${r.error.issues.map((i) => i.message).join("; ")}`);
      continue;
    }
    nodeCount += 1;
    if (nodeIds.has(r.data.id)) fail(`duplicate node id ${r.data.id}`);
    nodeIds.add(r.data.id);
    if (!itemIds.has(r.data.resourceItemId)) fail(`node ${r.data.id} yields unknown item ${r.data.resourceItemId}`);
    for (const sec of r.data.secondaries ?? []) {
      if (!itemIds.has(sec.itemId)) fail(`node ${r.data.id} secondary references unknown item ${sec.itemId}`);
    }
  }
  let nodePlacementCount = 0;
  for (const raw of NODE_PLACEMENTS) {
    const r = nodePlacementSchema.safeParse(raw);
    if (!r.success) {
      fail(`node placement ${raw.nodeId}/${raw.regionId}: ${r.error.issues.map((i) => i.message).join("; ")}`);
      continue;
    }
    nodePlacementCount += 1;
    if (!nodeIds.has(raw.nodeId)) fail(`node placement ${raw.nodeId}/${raw.regionId} references unknown node ${raw.nodeId}`);
    if (!regionIds.has(raw.regionId)) fail(`node placement ${raw.nodeId}/${raw.regionId} references unknown region ${raw.regionId}`);
  }

  const t = tuningSchema.safeParse(TUNING);
  if (!t.success) failures.push(`tuning: ${t.error.issues.map((i) => i.message).join("; ")}`);

  return {
    failures,
    itemCount,
    recipeCount,
    nodeCount,
    nodePlacementCount,
    radiationZoneCount,
    tuningKeyCount: Object.keys(TUNING).length,
  };
};
