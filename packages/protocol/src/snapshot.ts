/**
 * Snapshot + ReplicaRecord (GDD §21.7, §24).
 */
import { z } from "zod";

export const ItemStackSchema = z.object({
  itemId: z.string().regex(/^[a-z][a-z0-9_]*$/),
  quantity: z.number().int().min(1).max(255),
  payload: z.string().max(64).optional(),
});
export type ItemStackProto = z.infer<typeof ItemStackSchema>;

export const SpawnRecordSchema = z.object({
  kind: z.literal("spawn"),
  entityId: z.string().regex(/^e_[0-9a-f]{4,}$/),
  kindTag: z.enum(["player", "world", "corpse", "ground_item"]),
  position: z.object({ x: z.number().int(), y: z.number().int(), z: z.number().int() }),
  contentId: z.string().optional(),
  /** M2: node pool / accumulator / respawn for world entities */
  pool: z.number().int().optional(),
  accumulator: z.number().optional(),
  respawnAtTick: z.number().int().optional(),
  /** M2: the stack for ground items */
  stack: ItemStackSchema.optional(),
  despawnAtTick: z.number().int().optional(),
  /** M2: corpse contents (stable slot order) */
  inventory: z.array(ItemStackSchema.nullable()).max(40).optional(),
});

export const DeltaRecordSchema = z.object({
  kind: z.literal("delta"),
  entityId: z.string().regex(/^e_[0-9a-f]{4,}$/),
  position: z.object({ x: z.number().int(), y: z.number().int(), z: z.number().int() }).optional(),
  yawHundredths: z.number().int().optional(),
  pitchHundredths: z.number().int().optional(),
  health: z.number().int().min(0).max(100).optional(),
  calories: z.number().int().min(0).max(3000).optional(),
  posture: z.enum(["standing", "crouching"]).optional(),
  /** M2: node pool changes (gathering payout / respawn) */
  pool: z.number().int().min(0).optional(),
  accumulator: z.number().optional(),
  respawnAtTick: z.number().int().optional(),
  /** M2: ground stack quantity changed (merge/despawn of part) */
  stack: ItemStackSchema.optional(),
});

export const EventRecordSchema = z.object({
  kind: z.literal("event"),
  entityId: z.string().regex(/^e_[0-9a-f]{4,}$/).optional(),
  event: z.enum([
    "death",
    "damage",
    "pickup",
    "craft",
    "build",
    "destroy",
    "blueprint",
    "chat",
    // M2 authoritative events (GDD §21.7: never dropped, sent after commit)
    "gather",
    "inventory",
    "node_respawn",
    "ground_despawn",
    "respawn",
  ]),
  payload: z.record(z.unknown()).default({}),
});

export const ForgetRecordSchema = z.object({
  kind: z.literal("forget"),
  entityId: z.string().regex(/^e_[0-9a-f]{4,}$/),
});

export const ReplicaRecordSchema = z.discriminatedUnion("kind", [
  SpawnRecordSchema,
  DeltaRecordSchema,
  EventRecordSchema,
  ForgetRecordSchema,
]);
export type ReplicaRecordProto = z.infer<typeof ReplicaRecordSchema>;

export const SnapshotSchema = z.object({
  protocol: z.literal(1),
  serverTick: z.number().int().nonnegative(),
  batchSequence: z.number().int().nonnegative(),
  ackInputSequence: z.number().int().nonnegative(),
  baselineId: z.number().int().nonnegative(),
  records: z.array(ReplicaRecordSchema).max(200),
});
export type SnapshotProto = z.infer<typeof SnapshotSchema>;

export const HEARTBEAT_INTERVAL_S = 5;
export const HEARTBEAT_TIMEOUT_S = 15;
export const MAX_FRAME_BYTES = 64 * 1024;
export const MAX_BASELINE_BYTES = 2 * 1024 * 1024;
export const BASELINE_CHUNK_BYTES = 64 * 1024;
export const BACKPRESSURE_QUEUE_BYTES = 4 * 1024 * 1024;
export const BACKPRESSURE_WINDOW_S = 10;
