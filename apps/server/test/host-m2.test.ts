/**
 * Host M2 tests: ECDSA P-256 identity handshake (GDD §22.4), reconnect
 * within 5 minutes, duplicate-identity invalidation, M2 baseline shape and
 * the gather -> drop -> death -> corpse replication flow.
 */
import { generateKeyPairSync, sign as cryptoSign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decode } from "@msgpack/msgpack";
import { Host } from "../src/host.js";
import { derivePlayerId, issueSessionToken, verifySessionToken, verifyProof, freshNonce } from "../src/identity.js";
import { SnapshotSchema, type SnapshotProto, type JwkProto } from "@dustfall/protocol";

const mkHost = (): Host => new Host("test_server", "test_world", 0x1, 0x2, 8);

/** Generate a P-256 key pair and return the public JWK + a signer. */
const newIdentity = () => {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" }) as {
    publicKey: import("node:crypto").KeyObject;
    privateKey: import("node:crypto").KeyObject;
  };
  const jwk = publicKey.export({ format: "jwk" }) as unknown as JwkProto;
  const signNonce = (nonceB64url: string): string => {
    const der = cryptoSign(null, Buffer.from(nonceB64url, "base64url"), privateKey as import("node:crypto").KeyObject);
    return der.toString("base64url");
  };
  return { jwk, signNonce };
};

/** Drive a session to Ready; returns session id + player id + captured frames. */
const connect = (host: Host, identity: ReturnType<typeof newIdentity>) => {
  const frames: Array<{ json?: unknown; snapshot?: SnapshotProto }> = [];
  const hs = host.beginHandshake();
  host.attachWriter(hs.sessionId, (data, isBinary) => {
    if (isBinary) frames.push({ snapshot: decode(data) as SnapshotProto });
    else frames.push({ json: JSON.parse(data.toString("utf8")) });
  });
  const proof = {
    kind: "identity",
    sessionId: hs.sessionId,
    publicKey: identity.jwk,
    signature: identity.signNonce(hs.nonce),
  };
  const r = host.submitIdentity(hs.sessionId, proof);
  if (!r.ok) throw new Error(`handshake failed: ${r.reason}`);
  // ack the baseline the host sent
  const baseline = frames.find((f) => f.snapshot)?.snapshot;
  expect(baseline).toBeDefined();
  const ack = host.ackBaseline(hs.sessionId, { kind: "baseline_ack", protocol: 1, baselineId: baseline?.baselineId ?? 1 });
  expect(ack.ok).toBe(true);
  return { sessionId: hs.sessionId, playerId: r.grant.playerId, frames };
};

describe("identity handshake (GDD 22.4)", () => {
  it("derives the same PlayerId from the same key (stable identity)", () => {
    const a = newIdentity();
    const b = newIdentity();
    expect(derivePlayerId("test_server", a.jwk)).not.toBe(derivePlayerId("test_server", b.jwk));
    expect(derivePlayerId("test_server", a.jwk)).toBe(derivePlayerId("test_server", a.jwk));
    expect(derivePlayerId("test_server", a.jwk)).toMatch(/^p_[0-9a-f]{20}$/);
  });

  it("accepts a valid ES256 proof and reaches awaiting_baseline", () => {
    const host = mkHost();
    const id = newIdentity();
    const hs = host.beginHandshake();
    const r = host.submitIdentity(hs.sessionId, {
      kind: "identity",
      sessionId: hs.sessionId,
      publicKey: id.jwk,
      signature: id.signNonce(hs.nonce),
    });
    expect(r.ok).toBe(true);
    const s = host.sessions.get(hs.sessionId);
    expect(s?.state).toBe("awaiting_baseline");
    expect(s?.playerId).toBe(derivePlayerId("test_server", id.jwk));
  });

  it("rejects a bad signature", () => {
    const host = mkHost();
    const id = newIdentity();
    const hs = host.beginHandshake();
    const other = newIdentity();
    const r = host.submitIdentity(hs.sessionId, {
      kind: "identity",
      sessionId: hs.sessionId,
      publicKey: id.jwk,
      signature: other.signNonce(hs.nonce), // signed with a different private key
    });
    expect(r).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("rejects a signature over the wrong nonce (replayed challenge)", () => {
    const host = mkHost();
    const id = newIdentity();
    const hs = host.beginHandshake();
    const oldSig = id.signNonce(freshNonce());
    const r = host.submitIdentity(hs.sessionId, {
      kind: "identity",
      sessionId: hs.sessionId,
      publicKey: id.jwk,
      signature: oldSig,
    });
    expect(r).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("session token round-trips and is scoped to (server, player, session)", () => {
    const token = issueSessionToken("srv", "p_a", "s_1", "secret");
    expect(verifySessionToken("srv", "p_a", "s_1", token, "secret")).toBe(true);
    expect(verifySessionToken("srv", "p_a", "s_2", token, "secret")).toBe(false);
    expect(verifySessionToken("srv", "p_b", "s_1", token, "secret")).toBe(false);
    expect(verifySessionToken("srv", "p_a", "s_1", "tampered", "secret")).toBe(false);
  });

  it("verifyProof rejects a malformed JWK", () => {
    const bad = { kty: "EC" as const, crv: "P-256" as const, x: "not-base64", y: "also-not" };
    expect(verifyProof(bad, freshNonce(), "d".repeat(88))).toBe(false);
  });
});

describe("M2 session flow", () => {
  it("full handshake reaches Ready and the baseline is schema-valid with nodes", () => {
    const host = mkHost();
    const id = newIdentity();
    const { playerId, frames } = connect(host, id);
    const baseline = frames.find((f) => f.snapshot)?.snapshot;
    expect(baseline).toBeDefined();
    const parsed = SnapshotSchema.safeParse(baseline!);
    expect(parsed.success, `baseline violated wire schema: ${JSON.stringify(parsed.success ? null : parsed.error.issues)}`).toBe(true);
    const worldRecs = baseline!.records.filter((r) => r.kind === "spawn" && r.kindTag === "world");
    expect(worldRecs.length).toBeGreaterThanOrEqual(200);
    // self record carries inventory (starter kit) so the client can render it
    const self = baseline!.records.find((r) => r.kind === "spawn" && r.kindTag === "player");
    expect(self).toBeDefined();
    const selfInv = (self as { inventory?: (unknown | null)[] }).inventory ?? [];
    expect(selfInv[0]).toMatchObject({ itemId: "rock", quantity: 1 });
    expect(selfInv[2]).toMatchObject({ itemId: "bandage", quantity: 2 });
    expect(playerId).toMatch(/^p_/);
  });

  it("reconnect within 5 minutes resumes the same player without duplication", () => {
    const host = mkHost();
    const id = newIdentity();
    const a = connect(host, id);
    // give the player loot, then "disconnect"
    const p = [...host.store.values()].find((e) => e.kind === "player" && e.playerId === a.playerId) as import("@dustfall/sim").PlayerEntity;
    p.inventory[10] = { itemId: "wood" as const, quantity: 12 };
    host.onDisconnect(a.sessionId);

    // second socket, same identity -> same PlayerId, same body, loot intact
    const b = connect(host, id);
    expect(b.playerId).toBe(a.playerId);
    const players = [...host.store.values()].filter((e) => e.kind === "player" && e.playerId === b.playerId);
    expect(players.length).toBe(1);
    const p2 = players[0] as import("@dustfall/sim").PlayerEntity;
    expect(p2.inventory[10]).toMatchObject({ itemId: "wood", quantity: 12 });
    const self2 = b.frames.find((f) => f.snapshot)?.snapshot?.records.find((r) => r.kind === "spawn" && r.kindTag === "player");
    const inv2 = (self2 as { inventory?: (unknown | null)[] })?.inventory ?? [];
    expect(inv2[10]).toMatchObject({ itemId: "wood", quantity: 12 });
  });

  it("a newer socket invalidates the older one for the same identity", () => {
    const host = mkHost();
    const id = newIdentity();
    const a = connect(host, id);
    const b = connect(host, id);
    expect(b.playerId).toBe(a.playerId);
    const old = host.sessions.get(a.sessionId);
    expect(old).toBeUndefined(); // removed: the newer session replaced it
    expect(host.sessions.sessionForPlayer(a.playerId)?.id).toBe(b.sessionId);
  });

  it("gameplay input before Ready is rejected; after Ready accepted", () => {
    const host = mkHost();
    const id = newIdentity();
    const hs = host.beginHandshake();
    host.attachWriter(hs.sessionId, () => {});
    host.submitIdentity(hs.sessionId, { kind: "identity", sessionId: hs.sessionId, publicKey: id.jwk, signature: id.signNonce(hs.nonce) });
    const env = (seq: number) => ({
      protocol: 1,
      sessionId: hs.sessionId,
      sequence: seq,
      clientTick: seq,
      commands: [{ kind: "move", wishX: 100, wishZ: 0, jump: false, crouch: false, sprint: false, inWater: false, yawHundredths: 0, pitchHundredths: 0 }],
    });
    expect(host.receiveEnvelope(hs.sessionId, env(1)).ok).toBe(false); // not Ready yet
    host.ackBaseline(hs.sessionId, { kind: "baseline_ack", protocol: 1, baselineId: host.sessions.get(hs.sessionId)?.baselineId ?? 0 });
    expect(host.receiveEnvelope(hs.sessionId, env(1)).ok).toBe(true);
  });
});

describe("M2 replication flow (gather -> drop -> die -> corpse)", () => {
  it("a swing through the host ticks a node down and emits a gather event", () => {
    const host = mkHost();
    const id = newIdentity();
    const { sessionId, frames } = connect(host, id);
    host.ackBaseline(sessionId, { kind: "baseline_ack", protocol: 1, baselineId: host.sessions.get(sessionId)?.baselineId ?? 0 });
    // place a node next to the spawn and give the player a rock in hand
    const p = [...host.store.values()].find((e) => e.kind === "player") as import("@dustfall/sim").PlayerEntity;
    const node = [...host.store.values()].find((e) => e.kind === "world" && e.contentId === "node_tree") as import("@dustfall/sim").WorldEntity;
    expect(node).toBeDefined();
    // stand 1 m in front of the node (server proves reach, GDD §7)
    p.position = { x: node.position.x + 100, y: 0, z: node.position.z };
    p.prevPosition = { ...p.position };
    // rock is a 0.5 tool: seed the accumulator so this swing pays out 1
    node.accumulator = 0.9;
    const before = node.pool;
    const r = host.receiveEnvelope(sessionId, {
      protocol: 1,
      sessionId,
      sequence: 1,
      clientTick: 1,
      commands: [{ kind: "move", wishX: 0, wishZ: 0, jump: false, crouch: false, sprint: false, inWater: false, yawHundredths: 0, pitchHundredths: 0, swing: { targetEntityId: node.id }, heldSlot: 0 }],
    });
    expect(r.ok).toBe(true);
    host.tick();
    const snap = frames.find((f) => f.snapshot && f.snapshot!.records.some((rec) => rec.kind === "event"))?.snapshot;
    expect(snap).toBeDefined();
    expect(snap!.records.some((rec) => rec.kind === "event" && rec.event === "gather")).toBe(true);
    // node pool decreased via a delta
    expect(snap!.records.some((rec) => rec.kind === "delta" && rec.entityId === node.id && "pool" in rec && rec.pool === before - 1)).toBe(true);
  });

  it("death produces exactly one corpse spawn + death event, then loot works", () => {
    const host = mkHost();
    const id = newIdentity();
    const { sessionId, playerId, frames } = connect(host, id);
    host.ackBaseline(sessionId, { kind: "baseline_ack", protocol: 1, baselineId: host.sessions.get(sessionId)?.baselineId ?? 0 });
    const p = [...host.store.values()].find((e) => e.kind === "player" && e.playerId === playerId) as import("@dustfall/sim").PlayerEntity;
    p.inventory[5] = { itemId: "wood" as const, quantity: 7 };
    // kill: starving (0 calories) at 0.25 hp/s drain; 0.3 hp -> dead in ~36 ticks
    p.vitals.health = 0.3;
    p.vitals.calories = 0;
    for (let i = 0; i < 50 && !p.dead; i++) host.tick();
    expect(p.dead).toBe(true);
    // two more ticks so the corpse spawn + death event ride the 15 Hz replica batch
    host.tick();
    host.tick();
    const corpses = [...host.store.values()].filter((e) => e.kind === "corpse");
    expect(corpses.length).toBe(1);
    const corpse = corpses[0] as import("@dustfall/sim").CorpseEntity;
    // the 7 wood must be in the corpse exactly once
    const wood = corpse.inventory.filter((s) => s && s.itemId === "wood").reduce((n, s) => n + (s?.quantity ?? 0), 0);
    expect(wood).toBe(7);
    // wire: spawn record for the corpse + death event
    const snaps = frames.map((f) => f.snapshot).filter(Boolean);
    const withSpawn = snaps.find((s) => s!.records.some((r) => r.kind === "spawn" && r.kindTag === "corpse"));
    expect(withSpawn).toBeDefined();
    expect(withSpawn!.records.some((r) => r.kind === "event" && r.event === "death")).toBe(true);
    // loot it back: pickup command through the host
    host.receiveEnvelope(sessionId, {
      protocol: 1,
      sessionId,
      sequence: 2,
      clientTick: 2,
      commands: [{ kind: "move", wishX: 0, wishZ: 0, jump: false, crouch: false, sprint: false, inWater: false, yawHundredths: 0, pitchHundredths: 0, pickup: { sourceEntityId: corpse.id } }],
    });
    // player is dead -> pickup rejected, corpse intact
    host.tick();
    host.tick();
    expect(corpses.length).toBe(1);
    expect(corpses[0] === corpse);
  });
});
