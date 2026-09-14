import { describe, expect, it } from "vitest";
import { validateContent } from "../src/index.js";
import { TUNING } from "../src/index.js";
import { ITEMS } from "../src/index.js";
import { RECIPES } from "../src/index.js";

describe("content validation (GDD §24)", () => {
  it("launch content validates clean", () => {
    const result = validateContent();
    expect(result.failures).toEqual([]);
    expect(result.itemCount).toBeGreaterThan(20);
    expect(result.recipeCount).toBeGreaterThan(5);
  });

  it("all tuning keys are finite numbers or strings", () => {
    for (const [k, v] of Object.entries(TUNING)) {
      if (typeof v === "number") expect(Number.isFinite(v)).toBe(true);
    }
    expect(TUNING["time.tick_hz"]).toBe(30);
    expect(TUNING["move.walk_speed"]).toBe(3.5);
    expect(TUNING["build.grid_size"]).toBe(4);
  });

  it("starter items exist for the first-session arc", () => {
    const ids = new Set(ITEMS.map((i) => i.id));
    for (const required of [
      "rock", "torch", "bandage", "wood", "stone", "cloth",
      "stone_hatchet", "campfire", "furnace", "workbench",
      "wood_shelter", "sleeping_bag", "hunting_bow",
      "raw_rabbit_meat", "cooked_rabbit_meat", "research_kit",
    ]) {
      expect(ids.has(required)).toBe(true);
    }
  });

  it("every recipe input/output item exists", () => {
    const ids = new Set(ITEMS.map((i) => i.id));
    for (const r of RECIPES) {
      expect(ids.has(r.outputItemId)).toBe(true);
      for (const inp of r.inputs) expect(ids.has(inp.itemId)).toBe(true);
    }
  });
});
