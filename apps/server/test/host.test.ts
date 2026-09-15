/**
 * Host session flow tests (M2 handshake: challenge -> identity -> baseline ->
 * Ready). Covers T19 stale sequence rejection, input-before-Ready rejection,
 * 15 Hz batch cadence and the late-joiner baseline.
 */
import { generateKeyPairSync, sign as cryptoSign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { Host } from "../src/host.js";
import type { ClientEnvelopeProto, SnapshotProto, JwkProto } from "@dustfall/protocol";
import { SnapshotSchema } from "@dustfall/protocol";
import { decode } from "@msgpack/msgpack";

const mkHost = (): Host => new Host("test_server", "test_world", 0x1, 0x2, 8);

const newIdentity = () => {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" }) as {
    publicKey: import("node:crypto").KeyObject;
    privateKey: import("node:crypto").KeyObject;
  };
  const jwk = publicKey.export({ format: "jwk" }) as unknown as JwkProto;
  const signNonce = (nonceB64url: string): string =>
    cryptoSign(null, Buffer.from(nonceB64url, "base64url"), privateKey as import("node:crypto").KeyObject).toString("base64url");
  return { jwk, signNonce };
};

/** Drive a session to Ready. Returns { sessionId, playerId, baselines }. */
const registerSession = (host: Host): { sessionId: string; playerId: string; baselines: SnapshotProto[] } => {
  const id = newIdentity();
  const hs = host.beginHandshake();
  const baselines: SnapshotProto[] = [];
  host.attachWriter(hs.sessionId, (data, isBinary) => {
    if (!isBinary) return;
    const snap = decode(data) as SnapshotProto;
    const s = host.sessions.get(hs.sessionId);
    if (s?.state === "awaiting_baseline" || s?.state === "ready") baselines.push(snap);
  });
  const r = host.submitIdentity(hs.sessionId, { kind: "identity", sessionId: hs.sessionId, publicKey: id.jwk, signature: id.signNonce(hs.nonce) });
  if (!r.ok) throw new Error(`handshake failed: ${r.reason}`);
  host.ackBaseline(hs.sessionId, { kind: "baseline_ack", protocol: 1, baselineId: host.sessions.get(hs.sessionId)?.baselineId ?? 0 });
  return { sessionId: hs.sessionId, playerId: r.grant.playerId, baselines };
};

describe("host session flow (M2)", () => {
  it("rejects input before Ready (not_ready)", () => {
    const host = mkHost();
    const id = newIdentity();
    const hs = host.beginHandshake();
    host.attachWriter(hs.sessionId, () => {});
    host.submitIdentity(hs.sessionId, { kind: "identity", sessionId: hs.sessionId, publicKey: id.jwk, signature: id.signNonce(hs.nonce) });
    const env = {
      protocol: 1,
      sessionId: hs.sessionId,
      sequence: 1,
      clientTick: 1,
      commands: [{ kind: "move", wishX: 0, wishZ: 0, jump: false, crouch: false, sprint: false, inWater: false, yawHundredths: 0, pitchHundredths: 0 }],
    } satisfies ClientEnvelopeProto;
    expect(host.receiveEnvelope(hs.sessionId, env).ok).toBe(false);
  });

  it("accepts valid envelopes after Ready and moves the player", () => {
    const host = mkHost();
    const { sessionId } = registerSession(host);
    let seq = 0;
    for (let i = 0; i < 60; i++) {
      seq += 1;
      const r = host.receiveEnvelope(sessionId, {
        protocol: 1,
        sessionId,
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
    const { sessionId } = registerSession(host);
    const base = {
      protocol: 1,
      sessionId,
      clientTick: 1,
      commands: [{ kind: "move", wishX: 0, wishZ: 0, jump: false, crouch: false, sprint: false, inWater: false, yawHundredths: 0, pitchHundredths: 0 }],
    };
    expect(host.receiveEnvelope(sessionId, { ...base, sequence: 5 }).ok).toBe(true);
    expect((host.receiveEnvelope(sessionId, { ...base, sequence: 5 }) as { ok: boolean }).ok).toBe(false);
  });

  it("rejects malformed envelopes without mutating state", () => {
    const host = mkHost();
    const { sessionId } = registerSession(host);
    const before = host.store.size();
    host.receiveEnvelope(sessionId, { protocol: 99, garbage: true });
    host.receiveEnvelope(sessionId, { protocol: 1, sessionId, sequence: 1, clientTick: 1, commands: [{ kind: "teleport" }] });
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
    const a = registerSession(host);
    // p_1 walks for 2 s
    let seq = 0;
    for (let i = 0; i < 60; i++) {
      seq += 1;
      host.receiveEnvelope(a.sessionId, {
        protocol: 1,
        sessionId: a.sessionId,
        sequence: seq,
        clientTick: seq,
        commands: [{ kind: "move", wishX: 100, wishZ: 0, jump: false, crouch: false, sprint: false, inWater: false, yawHundredths: 0, pitchHundredths: 0 }],
      });
      host.tick();
    }

    // p_2 joins: its baseline must contain p_1 at the walked position,
    // with integer (cm) positions per GDD §21.5
    const b = registerSession(host);
    const baseline = b.baselines[0];
    expect(baseline).toBeDefined();
    const parsed = SnapshotSchema.safeParse(baseline!);
    expect(parsed.success, `baseline violated wire schema: ${JSON.stringify(parsed.success ? null : parsed.error.issues)}`).toBe(true);
    const otherPlayers = baseline!.records.filter((r) => r.kind === "spawn" && r.kindTag === "player");
    // the late joiner sees both players: itself + p_1
    expect(otherPlayers.length).toBe(2);
    const self = otherPlayers.find((r) => (r as { inventory?: unknown }).inventory) as { position: { x: number } } | undefined;
    const p1Rec = otherPlayers.find((r) => r !== self) as { position: { x: number } } | undefined;
    expect(p1Rec).toBeDefined();
    const moved = p1Rec?.position.x !== -15_000;
    expect(moved).toBe(true);
    expect(b.playerId).not.toBe(a.playerId);
  });
});
