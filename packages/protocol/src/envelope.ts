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

export const EquipmentSlotName = z.enum(["helmet", "vest", "pants", "boots"]);

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
    /** M2 intents: inputs only, never outcomes (GDD §21.4) */
    swing: z.object({ targetEntityId: z.string().regex(/^e_[0-9a-f]{4,}$/) }).optional(),
    pickup: z.object({ sourceEntityId: z.string().regex(/^e_[0-9a-f]{4,}$/) }).optional(),
    drop: z.object({ slot: z.number().int().min(0).max(35) }).optional(),
    moveItem: z
      .object({
        from: z.number().int().min(0).max(35),
        /** 0..35 target grid slot, or -1 when equipping/unequipping */
        to: z.number().int().min(-1).max(35),
        equip: EquipmentSlotName.optional(),
      })
      .optional(),
    /** hotbar slot 0..7 selection; the server derives heldItemId from it */
    heldSlot: z.number().int().min(-1).max(35).optional(),
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

/**
 * M2 identity handshake (GDD §22.4): the browser generates an ECDSA P-256
 * key pair (Web Crypto, stored in IndexedDB); the server stores only the
 * public JWK. PlayerId = SHA-256(serverId + canonical JWK). Login: the
 * server sends a 32-byte nonce, the client signs it (ECDSA/SHA-256);
 * the server verifies. A 24-hour HMAC-SHA-256 session token scopes the
 * authenticated session (serverId, playerId, sessionId).
 */
export const JwkSchema = z.object({
  kty: z.literal("EC"),
  crv: z.literal("P-256"),
  x: z.string().min(43).max(44), // base64url, unpadded
  y: z.string().min(43).max(44),
  alg: z.literal("ES256").optional(),
});
export type JwkProto = z.infer<typeof JwkSchema>;

/** server -> client, right after the hello */
export const ChallengeSchema = z.object({
  protocol: z.literal(1),
  sessionId: z.string().min(1).max(128),
  /** 32 random bytes, base64url */
  nonce: z.string().min(43).max(44),
});
export type ChallengeProto = z.infer<typeof ChallengeSchema>;

/** client -> server, the identity proof */
export const IdentityProofSchema = z.object({
  protocol: z.literal(1),
  sessionId: z.string().min(1).max(128),
  publicKey: JwkSchema,
  /** ES256 signature of the nonce (DER-encoded from Web Crypto), base64url */
  signature: z.string().min(43).max(120),
});
export type IdentityProofProto = z.infer<typeof IdentityProofSchema>;

/** server -> client, issued after verification */
export const SessionGrantSchema = z.object({
  protocol: z.literal(1),
  sessionId: z.string().min(1).max(128),
  playerId: z.string().min(3).max(80),
  /** epoch ms the grant expires at */
  expiresAt: z.number().int().nonnegative(),
  /** opaque HMAC-SHA-256 session token */
  token: z.string().min(43).max(90),
  /** true when this identity has a saved player in this world (M2 reconnect) */
  hasSavedPlayer: z.boolean(),
});
export type SessionGrantProto = z.infer<typeof SessionGrantSchema>;
