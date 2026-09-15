/**
 * Entity store: stable ascending EntityId iteration (GDD §21.5).
 * M1 components: position, posture, vitals, inventory, equipment, blueprints.
 */
import type { EntityId, PlayerId, Vec3, Vitals, ItemStack, ItemId } from "@dustfall/contracts";
import { freshVitals, INVENTORY_SLOTS, type EquipmentSlot, EQUIPMENT_SLOTS } from "@dustfall/contracts";
import { createEntityId } from "./ids.js";

export type Posture = "standing" | "crouching";

export interface PlayerEntity {
  id: EntityId;
  kind: "player";
  playerId: PlayerId;
  /** world position in cm */
  position: Vec3;
  /** previous-tick position for fall detection (cm) */
  prevPosition: Vec3;
  /** velocity in cm/s (vertical only authoritative here; horizontal is intent) */
  velocityY: number;
  onGround: boolean;
  posture: Posture;
  /** yaw/pitch in 1/100 degree, last acknowledged by server */
  yawHundredths: number;
  pitchHundredths: number;
  vitals: Vitals;
  /**
   * The item id held in hand (the tool/weapon used for gathering swings,
   * GDD §7). The client selects it via hotbar; the server treats it as
   * input, not outcome.
   */
  heldItemId: ItemId | null;
  /** tick until which swings are on cooldown (GDD §7 swing cadence) */
  swingCooldownUntilTick: number;
  /** 36 slots, null = empty */
  inventory: (ItemStack | null)[];
  /** 4 equipment slots */
  equipment: Partial<Record<EquipmentSlot, ItemStack>>;
  /** blueprint payloads learned this world */
  blueprints: string[];
  /** true while a death transaction is in flight */
  dead: boolean;
  /** ticks since last tick the player was alive */
  deadTicks: number;
}

export interface WorldEntity {
  id: EntityId;
  kind: "world";
  /** node or structure id from content */
  contentId: string;
  position: Vec3;
  /** node pool remaining (resources) or structure hp */
  pool: number;
  /**
   * Harvest accumulator: fractions of a resource unit accrued by
   * tool-multiplier swings (GDD §7). Each whole unit pays out one
   * resource and the pool decreases by one.
   */
  accumulator: number;
  /**
   * Depletion state: a depleted node stays in place (no collision, no
   * yield) until its seeded respawn timer elapses. respawnAtTick is set
   * to the tick it was depleted; 0 = not respawnable.
   */
  respawnAtTick: number;
}

export interface CorpseEntity {
  id: EntityId;
  kind: "corpse";
  position: Vec3;
  inventory: (ItemStack | null)[];
}

export interface GroundItemEntity {
  id: EntityId;
  kind: "ground_item";
  position: Vec3;
  stack: ItemStack;
  despawnAtTick: number;
}

export type Entity = PlayerEntity | WorldEntity | CorpseEntity | GroundItemEntity;

/**
 * Entity store with deterministic ascending-EntityId iteration.
 * EntityIds are numeric (monotonic) for stable ordering.
 */
export class EntityStore {
  private readonly byId = new Map<number, Entity>();
  private nextId = 1;

  allocate(): EntityId {
    const n = this.nextId;
    this.nextId += 1;
    return createEntityId(n);
  }

  insert(e: Entity): void {
    this.byId.set(parseEntityId(e.id), e);
  }

  /**
   * Set the next allocation past the largest restored entity id. Used when
   * loading a persisted world so freshly allocated ids never collide with
   * stored ones (GDD §24 entity ids are globally unique).
   */
  setNextIdAfter(ids: readonly EntityId[]): void {
    let max = 0;
    for (const id of ids) {
      const n = parseEntityId(id);
      if (n > max) max = n;
    }
    this.nextId = max + 1;
  }

  get(id: EntityId): Entity | undefined {
    return this.byId.get(parseEntityId(id));
  }

  remove(id: EntityId): void {
    this.byId.delete(parseEntityId(id));
  }

  /** Stable ascending iteration. */
  *values(): IterableIterator<Entity> {
    const ids = [...this.byId.keys()].sort((a, b) => a - b);
    for (const id of ids) {
      const e = this.byId.get(id);
      if (e !== undefined) yield e;
    }
  }

  size(): number {
    return this.byId.size;
  }
}

const parseEntityId = (id: EntityId): number => {
  const s = id as string;
  const hex = s.startsWith("e_") ? s.slice(2) : s;
  const n = parseInt(hex, 16);
  if (Number.isNaN(n)) throw new Error(`bad entity id ${s}`);
  return n;
};

export const newPlayer = (
  id: EntityId,
  playerId: PlayerId,
  spawn: Vec3,
): PlayerEntity => ({
  id,
  kind: "player",
  playerId,
  position: { ...spawn },
  prevPosition: { ...spawn },
  velocityY: 0,
  onGround: true,
  posture: "standing",
  yawHundredths: 0,
  pitchHundredths: 0,
  heldItemId: null,
  swingCooldownUntilTick: 0,
  vitals: freshVitals(),
  inventory: new Array<ItemStack | null>(INVENTORY_SLOTS).fill(null),
  equipment: {},
  blueprints: [],
  dead: false,
  deadTicks: 0,
});

export { EQUIPMENT_SLOTS };
