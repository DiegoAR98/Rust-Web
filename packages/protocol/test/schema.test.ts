import { describe, expect, it } from "vitest";
import {
  ClientEnvelopeSchema,
  SnapshotSchema,
  MovementIntentSchema,
  ItemStackSchema,
  ChallengeSchema,
  IdentityProofSchema,
  SessionGrantSchema,
} from "../src/index.js";

describe("client envelope (GDD §24)", () => {
  it("accepts a valid move envelope", () => {
    const env = {
      protocol: 1,
      sessionId: "s_1",
      sequence: 42,
      clientTick: 42,
      commands: [{ kind: "move", wishX: 100, wishZ: 0, jump: false, crouch: false, sprint: false, inWater: false, yawHundredths: 0, pitchHundredths: 0 }],
    };
    expect(ClientEnvelopeSchema.safeParse(env).success).toBe(true);
  });

  it("rejects wrong protocol version", () => {
    const env = {
      protocol: 2,
      sessionId: "s_1",
      sequence: 1,
      clientTick: 1,
      commands: [],
    };
    expect(ClientEnvelopeSchema.safeParse(env).success).toBe(false);
  });

  it("rejects NaN and out-of-bounds wish values (T19)", () => {
    const bad = {
      protocol: 1,
      sessionId: "s_1",
      sequence: 1,
      clientTick: 1,
      commands: [{ kind: "move", wishX: NaN, wishZ: 0, jump: false, crouch: false, sprint: false, inWater: false, yawHundredths: 0, pitchHundredths: 0 }],
    };
    expect(ClientEnvelopeSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects unknown command kinds", () => {
    const bad = {
      protocol: 1,
      sessionId: "s_1",
      sequence: 1,
      clientTick: 1,
      commands: [{ kind: "teleport", x: 0 }],
    };
    expect(ClientEnvelopeSchema.safeParse(bad).success).toBe(false);
  });
});

describe("snapshot", () => {
  it("accepts a valid snapshot with delta records", () => {
    const snap = {
      protocol: 1,
      serverTick: 60,
      batchSequence: 30,
      ackInputSequence: 99,
      baselineId: 1,
      records: [
        {
          kind: "delta",
          entityId: "e_0001",
          position: { x: 100, y: 0, z: 100 },
          health: 100,
        },
      ],
    };
    expect(SnapshotSchema.safeParse(snap).success).toBe(true);
  });

  it("rejects non-integer position (quantization rule)", () => {
    const snap = {
      protocol: 1,
      serverTick: 60,
      batchSequence: 30,
      ackInputSequence: 99,
      baselineId: 1,
      records: [{ kind: "delta", entityId: "e_0001", position: { x: 1.5, y: 0, z: 0 } }],
    };
    expect(SnapshotSchema.safeParse(snap).success).toBe(false);
  });

  it("rejects malformed entity ids", () => {
    const snap = {
      protocol: 1,
      serverTick: 60,
      batchSequence: 30,
      ackInputSequence: 99,
      baselineId: 1,
      records: [{ kind: "forget", entityId: "not_an_entity" }],
    };
    expect(SnapshotSchema.safeParse(snap).success).toBe(false);
  });
});

describe("M2 identity handshake (GDD 22.4)", () => {
  const jwk = { kty: "EC" as const, crv: "P-256" as const, x: "a".repeat(43), y: "b".repeat(43) };

  it("accepts a valid challenge / proof / grant triple", () => {
    expect(ChallengeSchema.safeParse({ protocol: 1, sessionId: "s_1", nonce: "c".repeat(43) }).success).toBe(true);
    const proof = IdentityProofSchema.safeParse({ protocol: 1, sessionId: "s_1", publicKey: jwk, signature: "d".repeat(88) });
    expect(proof.success).toBe(true);
    const grant = SessionGrantSchema.safeParse({ protocol: 1, sessionId: "s_1", playerId: "p_a1b2c3", expiresAt: 1_900_000_000_000, token: "e".repeat(64), hasSavedPlayer: false });
    expect(grant.success).toBe(true);
  });

  it("rejects a non-P-256 JWK", () => {
    const bad = { protocol: 1, sessionId: "s_1", publicKey: { ...jwk, crv: "secp384r1" }, signature: "d".repeat(88) };
    expect(IdentityProofSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects an oversized signature", () => {
    const bad = { protocol: 1, sessionId: "s_1", publicKey: jwk, signature: "d".repeat(500) };
    expect(IdentityProofSchema.safeParse(bad).success).toBe(false);
  });
});

describe("M2 wire records", () => {
  it("item stack schema enforces catalog bounds", () => {
    expect(ItemStackSchema.safeParse({ itemId: "wood", quantity: 100 }).success).toBe(true);
    expect(ItemStackSchema.safeParse({ itemId: "Wood", quantity: 100 }).success).toBe(false);
    expect(ItemStackSchema.safeParse({ itemId: "wood", quantity: 0 }).success).toBe(false);
    expect(ItemStackSchema.safeParse({ itemId: "wood", quantity: 256 }).success).toBe(false);
  });

  it("spawn records carry M2 node/corpse/ground payloads", () => {
    const snap = {
      protocol: 1,
      serverTick: 5,
      batchSequence: 1,
      ackInputSequence: 0,
      baselineId: 1,
      records: [
        { kind: "spawn", entityId: "e_0001", kindTag: "world", position: { x: 0, y: 0, z: 0 }, contentId: "node_tree", pool: 8, accumulator: 0.5, respawnAtTick: 0 },
        { kind: "spawn", entityId: "e_0002", kindTag: "ground_item", position: { x: 10, y: 0, z: 10 }, stack: { itemId: "wood", quantity: 12 }, despawnAtTick: 900 },
        { kind: "spawn", entityId: "e_0003", kindTag: "corpse", position: { x: 20, y: 0, z: 20 }, inventory: [{ itemId: "wood", quantity: 3 }, null] },
        { kind: "delta", entityId: "e_0001", pool: 7, accumulator: 0.5 },
        { kind: "event", entityId: "e_0001", event: "gather", payload: { payout: 1 } },
        { kind: "event", event: "ground_despawn", payload: { entityId: "e_0002" } },
        { kind: "forget", entityId: "e_0002" },
      ],
    };
    expect(SnapshotSchema.safeParse(snap).success).toBe(true);
  });

  it("M2 client commands validate (swing/pickup/drop/moveItem/heldSlot)", () => {
    const base = { kind: "move", wishX: 0, wishZ: 0, jump: false, crouch: false, sprint: false, inWater: false, yawHundredths: 0, pitchHundredths: 0 };
    const env = {
      protocol: 1,
      sessionId: "s_1",
      sequence: 7,
      clientTick: 7,
      commands: [
        { ...base, swing: { targetEntityId: "e_0001" } },
        { ...base, pickup: { sourceEntityId: "e_0002" } },
        { ...base, drop: { slot: 3 } },
        { ...base, moveItem: { from: 0, to: 5 } },
        { ...base, moveItem: { from: 2, to: -1, equip: "vest" } },
        { ...base, heldSlot: 28 },
      ],
    };
    expect(ClientEnvelopeSchema.safeParse(env).success).toBe(true);
  });

  it("rejects M2 commands with out-of-range slots or bad entity ids", () => {
    const base = { kind: "move", wishX: 0, wishZ: 0, jump: false, crouch: false, sprint: false, inWater: false, yawHundredths: 0, pitchHundredths: 0 };
    const bads = [
      { ...base, drop: { slot: 36 } },
      { ...base, swing: { targetEntityId: "x_1" } },
      { ...base, moveItem: { from: 0, to: 40 } },
    ];
    for (const bad of bads) {
      expect(ClientEnvelopeSchema.safeParse({ protocol: 1, sessionId: "s", sequence: 1, clientTick: 1, commands: [bad] }).success).toBe(false);
    }
  });
});

describe("M3 crafting commands + records", () => {
  const base = { kind: "move", wishX: 0, wishZ: 0, jump: false, crouch: false, sprint: false, inWater: false, yawHundredths: 0, pitchHundredths: 0 };
  const env = (commands: unknown[]) => ({ protocol: 1, sessionId: "s", sequence: 1, clientTick: 1, commands });

  it("accepts M3 craft/research/place intents", () => {
    expect(
      ClientEnvelopeSchema.safeParse(env([{ ...base, craft: { recipeId: "recipe_bandage" } }])).success,
    ).toBe(true);
    expect(
      ClientEnvelopeSchema.safeParse(env([{ ...base, craft: { recipeId: "recipe_pickaxe", structureEntityId: "e_0010" } }])).success,
    ).toBe(true);
    expect(
      ClientEnvelopeSchema.safeParse(env([{ ...base, research: { structureEntityId: "e_0010", itemId: "hatchet" } }])).success,
    ).toBe(true);
    expect(
      ClientEnvelopeSchema.safeParse(env([{ ...base, place: { slot: 5, position: { x: 100, y: 0, z: -200 } } }])).success,
    ).toBe(true);
  });

  it("rejects malformed M3 intents", () => {
    expect(ClientEnvelopeSchema.safeParse(env([{ ...base, craft: { recipeId: "" } }])).success).toBe(false);
    expect(ClientEnvelopeSchema.safeParse(env([{ ...base, research: { structureEntityId: "nope", itemId: "hatchet" } }])).success).toBe(false);
    expect(ClientEnvelopeSchema.safeParse(env([{ ...base, place: { slot: 36, position: { x: 0, y: 0, z: 0 } } }])).success).toBe(false);
    expect(ClientEnvelopeSchema.safeParse(env([{ ...base, place: { slot: 0, position: { x: 0.5, y: 0, z: 0 } } }])).success).toBe(false);
  });

  it("snapshot carries structures, craft state and blueprints", () => {
    const snap = {
      protocol: 1,
      serverTick: 10,
      batchSequence: 3,
      ackInputSequence: 1,
      baselineId: 1,
      records: [
        {
          kind: "spawn",
          entityId: "e_000a",
          kindTag: "structure",
          position: { x: 0, y: 0, z: 100 },
          contentId: "furnace",
          ownerId: "player_a",
          hp: 100,
        },
        { kind: "delta", entityId: "e_000a", craft: { recipeId: "recipe_metal_fragments", completesAtTick: 400, startedBy: "player_a" } },
        { kind: "delta", entityId: "e_000b", playerId: "player_a", blueprints: ["bp_pickaxe"] },
        { kind: "event", event: "craft", payload: { recipeId: "recipe_bandage", itemId: "bandage" } },
        { kind: "event", event: "build", payload: { structureEntityId: "e_000a" } },
        { kind: "event", event: "blueprint", payload: { payload: "bp_pickaxe" } },
      ],
    };
    expect(SnapshotSchema.safeParse(snap).success).toBe(true);
  });
});
