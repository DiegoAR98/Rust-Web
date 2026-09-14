import { describe, expect, it } from "vitest";
import { Host } from "../src/host.js";
import type { ClientEnvelopeProto, SnapshotProto } from "@dustfall/protocol";
import { SnapshotSchema } from "@dustfall/protocol";
import { decode } from "@msgpack/msgpack";

const mkHost = (): Host => new Host("test_world", 0x1, 0x2, 8);

/** Register a session in the host's registry (mirrors the WebSocket flow). */
const registerSession = (host: Host, id: string, playerId: string): void => {
  host.sessions.add({
    id,
    playerId,
    state: "awaiting_baseline",
    ackInputSequence: 0,
    pending: [],
    joinedAtTick: 0,
    queuedBytes: 0,
    backpressureSince: null,
  });
};

describe("host session flow", () => {
  it("rejects input before Ready (not_ready)", () => {
    const host = mkHost();
    const reg = host.sessions;
    const s = {
      id: "s_1",
      playerId: "p_1",
      state: "connecting" as const,
      ackInputSequence: 0,
      pending: [],
      joinedAtTick: 0,
      queuedBytes: 0,
      backpressureSince: null,
    };
    reg.add(s);
    const env = {
      protocol: 1,
      sessionId: "s_1",
      sequence: 1,
      clientTick: 1,
      commands: [{ kind: "move", wishX: 0, wishZ: 0, jump: false, crouch: false, sprint: false, inWater: false, yawHundredths: 0, pitchHundredths: 0 }],
    } satisfies ClientEnvelopeProto;
    expect(host.receiveEnvelope("s_1", env).ok).toBe(false);
  });

  it("accepts valid envelopes after spawn and moves the player", () => {
    const host = mkHost();
    registerSession(host, "s_1", "p_1");
    host.spawnPlayer("s_1", "p_1");
    const session = host.sessions.get("s_1");
    expect(session?.state).toBe("ready");

    let seq = 0;
    for (let i = 0; i < 60; i++) {
      seq += 1;
      const r = host.receiveEnvelope("s_1", {
        protocol: 1,
        sessionId: "s_1",
        sequence: seq,
        clientTick: seq,
        commands: [{ kind: "move", wishX: 100, wishZ: 0, jump: false, crouch: false, sprint: false, inWater: false, yawHundredths: 0, pitchHundredths: 0 }],
      });
      expect(r.ok).toBe(true);
      host.tick();
    }
    // 2 s of walking from the Bootheel spawn (-150 m x): ~+7 m
    const p = [...host.store.values()].find((e) => e.kind === "player");
    expect(p).toBeDefined();
    const pos = (p as { position: { x: number } }).position;
    expect(pos.x).toBeGreaterThan(-15_000 + 600);
    expect(pos.x).toBeLessThan(-15_000 + 800);
  });

  it("rejects stale sequence numbers (T19)", () => {
    const host = mkHost();
    registerSession(host, "s_1", "p_1");
    host.spawnPlayer("s_1", "p_1");
    const base = {
      protocol: 1,
      sessionId: "s_1",
      clientTick: 1,
      commands: [{ kind: "move", wishX: 0, wishZ: 0, jump: false, crouch: false, sprint: false, inWater: false, yawHundredths: 0, pitchHundredths: 0 }],
    };
    expect(host.receiveEnvelope("s_1", { ...base, sequence: 5 }).ok).toBe(true);
    expect((host.receiveEnvelope("s_1", { ...base, sequence: 5 }) as { ok: boolean }).ok).toBe(false);
  });

  it("rejects malformed envelopes without mutating state", () => {
    const host = mkHost();
    registerSession(host, "s_1", "p_1");
    host.spawnPlayer("s_1", "p_1");
    const before = host.store.size();
    host.receiveEnvelope("s_1", { protocol: 99, garbage: true });
    host.receiveEnvelope("s_1", { protocol: 1, sessionId: "s_1", sequence: 1, clientTick: 1, commands: [{ kind: "teleport" }] });
    expect(host.store.size()).toBe(before);
  });

  it("replica batches are due on every second tick (15 Hz)", () => {
    const host = mkHost();
    const due: number[] = [];
    for (let i = 1; i <= 30; i++) {
      if (host.tick()) due.push(host.world.clock.tick);
    }
    expect(due).toEqual([1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21, 23, 25, 27, 29]);
  });

  it("late-joiner baseline contains other players and conforms to the wire schema", () => {
    const host = mkHost();
    const baselines: SnapshotProto[] = [];
    const captureBaseline = (data: Buffer): void => {
      const msg = decode(data) as SnapshotProto;
      if (msg.records.some((r) => r.kind === "spawn")) baselines.push(msg);
    };
    registerSession(host, "s_1", "p_1");
    host.attachWriter("s_1", (data) => captureBaseline(data));
    host.spawnPlayer("s_1", "p_1");

    // p_1 walks for 2 s
    let seq = 0;
    for (let i = 0; i < 60; i++) {
      seq += 1;
      host.receiveEnvelope("s_1", {
        protocol: 1,
        sessionId: "s_1",
        sequence: seq,
        clientTick: seq,
        commands: [{ kind: "move", wishX: 100, wishZ: 0, jump: false, crouch: false, sprint: false, inWater: false, yawHundredths: 0, pitchHundredths: 0 }],
      });
      host.tick();
    }

    // p_2 joins: its baseline must contain p_1 at the walked position,
    // with integer (cm) positions per GDD §21.5
    const countBefore = baselines.length;
    registerSession(host, "s_2", "p_2");
    host.attachWriter("s_2", (data) => captureBaseline(data));
    host.spawnPlayer("s_2", "p_2");
    const baseline = baselines[baselines.length - 1];
    if (!baseline) throw new Error("no baseline captured for late joiner");
    expect(baselines.length).toBe(countBefore + 1);

    const parsed = SnapshotSchema.safeParse(baseline);
    expect(parsed.success, `baseline violated wire schema: ${JSON.stringify(parsed.success ? null : parsed.error.issues)}`).toBe(true);
    const p1Rec = baseline.records.filter(
      (r): r is Extract<(typeof baseline.records)[number], { kind: "spawn" }> =>
        r.kind === "spawn" && r.entityId !== "e_0002",
    )[0];
    expect(p1Rec).toBeDefined();
    const moved = p1Rec?.position.x !== -15_000;
    expect(moved).toBe(true);
  });
});
