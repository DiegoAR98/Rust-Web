import { describe, expect, it } from "vitest";
import {
  ClientEnvelopeSchema,
  SnapshotSchema,
  MovementIntentSchema,
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
