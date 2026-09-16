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
  // M6: the weapon/explosive/armor ladder. Each payload is carried by its own
  // item, so looting one lets a player research it at a Workbench and craft
  // more (GDD §9: research = one Research Kit + one unit of the item).
  { payload: "bp_assault_rifle", sourceItemId: "assault_rifle" },
  { payload: "bp_bolt_action_rifle", sourceItemId: "bolt_action_rifle" },
  { payload: "bp_explosive_charge", sourceItemId: "explosive_charge" },
  { payload: "bp_ballistic_helmet", sourceItemId: "ballistic_helmet" },
  { payload: "bp_ballistic_vest", sourceItemId: "ballistic_vest" },
  { payload: "bp_ballistic_pants", sourceItemId: "ballistic_pants" },
  { payload: "bp_ballistic_boots", sourceItemId: "ballistic_boots" },
];
