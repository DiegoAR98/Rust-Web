/**
 * M3 blueprint payloads (GDD §9: blueprints are the only persistent
 * progression; they survive death but belong to the current world save).
 *
 * A payload is "researchable" when a physical item can be studied at a
 * Workbench (one Research Kit + one unit of the item → the payload is
 * permanently learned, GDD §9 Research). A payload NOT carried by any item
 * comes only from loot (GDD §9: `bp_metal_building` is the canonical
 * example — "the one payload that comes only from loot; no item carries it").
 *
 * A recipe's `requiresBlueprint` field references one of these payloads;
 * the content validator cross-checks both directions.
 */
export interface BlueprintDef {
  /** payload id (bp_*) */
  payload: string;
  /** the item whose research teaches this payload; undefined = loot-only */
  sourceItemId: string | undefined;
}

/**
 * Launch blueprint payloads shipped with M3. M3 ships the ones the
 * first-session arc and the M3 gate need: the pickaxe (research a Hatchet)
 * and the loot-only metal building payload. The full ladder (firearms,
 * attachments, suits, medkits, storage) lands with M4+ content.
 */
export const BLUEPRINTS: readonly BlueprintDef[] = [
  { payload: "bp_pickaxe", sourceItemId: "hatchet" },
  { payload: "bp_metal_building", sourceItemId: undefined }, // loot-only, GDD §9
];
