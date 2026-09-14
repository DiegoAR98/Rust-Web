/**
 * ClientEnvelope (GDD §24).
 * Intents carry inputs, never outcomes (GDD §21.4).
 */
import { z } from "zod";

export const MovementIntentSchema = z.object({
  wishX: z.number().int().min(-100_000).max(100_000),
  wishZ: z.number().int().min(-100_000).max(100_000),
  jump: z.boolean(),
  crouch: z.boolean(),
  sprint: z.boolean(),
  inWater: z.boolean(),
});
export type MovementIntentProto = z.infer<typeof MovementIntentSchema>;

export const ClientCommandSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("move"),
    wishX: z.number().int().min(-100_000).max(100_000),
    wishZ: z.number().int().min(-100_000).max(100_000),
    jump: z.boolean(),
    crouch: z.boolean(),
    sprint: z.boolean(),
    inWater: z.boolean(),
    yawHundredths: z.number().int().min(-1_000_000).max(1_000_000),
    pitchHundredths: z.number().int().min(-90_000).max(90_000),
  }),
]);
export type ClientCommandProto = z.infer<typeof ClientCommandSchema>;

export const ClientEnvelopeSchema = z.object({
  protocol: z.literal(1),
  sessionId: z.string().min(1).max(128),
  sequence: z.number().int().nonnegative().max(2 ** 31),
  clientTick: z.number().int().nonnegative().max(2 ** 31),
  commands: z.array(ClientCommandSchema).max(10),
});
export type ClientEnvelopeProto = z.infer<typeof ClientEnvelopeSchema>;

export const ServerHelloSchema = z.object({
  protocol: z.literal(1),
  serverTick: z.number().int().nonnegative(),
  worldId: z.string().min(1).max(64),
});
export type ServerHello = z.infer<typeof ServerHelloSchema>;

export const BaselineAckSchema = z.object({
  protocol: z.literal(1),
  baselineId: z.number().int().nonnegative(),
});
export type BaselineAck = z.infer<typeof BaselineAckSchema>;
