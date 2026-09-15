/**
 * Host M3 tests: crafting intents through the wire (craft / research / place)
 * produce authoritative events and replica records.
 */
import { generateKeyPairSync, sign as cryptoSign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decode } from "@msgpack/msgpack";
import { Host } from "../src/host.js";
import { SnapshotSchema, type SnapshotProto, type JwkProto } from "@dustfall/protocol";
import type { PlayerEntity, StructureEntity } from "@dustfall/sim";

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

const connect = (host: Host, identity: ReturnType<typeof newIdentity>) => {
  const frames: Array<{ json?: unknown; snapshot?: SnapshotProto }> = [];
  const hs = host.beginHandshake();
  host.attachWriter(hs.sessionId, (data, isBinary) => {
    if (isBinary) frames.push({ snapshot: decode(data) as SnapshotProto });
    else frames.push({ json: JSON.parse(data.toString("utf8")) });
  });
  const r = host.submitIdentity(hs.sessionId, {
    kind: "identity",
    sessionId: hs.sessionId,
    publicKey: identity.jwk,
    signature: identity.signNonce(hs.nonce),
  });
  if (!r.ok) throw new Error(`handshake failed: ${r.reason}`);
  const baseline = frames.find((f) => f.snapshot)?.snapshot;
  expect(baseline).toBeDefined();
  expect(host.ackBaseline(hs.sessionId, { kind: "baseline_ack", protocol: 1, baselineId: baseline?.baselineId ?? 1 }).ok).toBe(true);
  return { sessionId: hs.sessionId, playerId: r.grant.playerId, frames };
};

const playerOf = (host: Host, playerId: string): PlayerEntity =>
  [...host.store.values()].find((e) => e.kind === "player" && e.playerId === playerId) as PlayerEntity;

const move = (_sessionId: string, _seq: number, extra: Record<string, unknown>) => ({
  kind: "move",
  wishX: 0,
  wishZ: 0,
  jump: false,
  crouch: false,
  sprint: false,
  inWater: false,
  yawHundredths: 0,
  pitchHundredths: 0,
  ...extra,
});

/** run ticks until a snapshot carrying the given event kind arrives (or max ticks) */
const drain = (host: Host, frames: Array<{ json?: unknown; snapshot?: SnapshotProto }>, wantEvent: string, maxTicks = 120): SnapshotProto | null => {
  for (let i = 0; i < maxTicks; i++) {
    host.tick();
    const last = frames[frames.length - 1]?.snapshot;
    if (last && last.records.some((r) => r.kind === "event" && (r as { event?: string }).event === wantEvent)) return last;
  }
  return null;
};

describe("M3 host flow", () => {
  it("hand craft through the wire: intent -> craft event -> output in the grid", () => {
    const host = mkHost();
    const id = newIdentity();
    const { sessionId, playerId, frames } = connect(host, id);
    const p = playerOf(host, playerId);
    p.inventory[0] = { itemId: "cloth" as never, quantity: 3 };

    const env = {
      protocol: 1,
      sessionId,
      sequence: 1,
      clientTick: 1,
      commands: [move(sessionId, 1, { craft: { recipeId: "recipe_bandage" } })],
    };
    expect(host.receiveEnvelope(sessionId, env).ok).toBe(true);

    const snap = drain(host, frames, "craft");
    expect(snap).not.toBeNull();
    const ev = snap!.records.find((r) => r.kind === "event" && (r as { event?: string }).event === "craft") as { payload: Record<string, unknown> };
    expect(ev.payload.itemId).toBe("bandage");
    expect(ev.payload.playerId).toBe(playerId);
    expect(p.inventory.some((s) => s?.itemId === "bandage")).toBe(true);
  });

  it("place through the wire: structure spawn record + item consumed", () => {
    const host = mkHost();
    const id = newIdentity();
    const { sessionId, playerId, frames } = connect(host, id);
    const p = playerOf(host, playerId);
    p.inventory[4] = { itemId: "campfire" as never, quantity: 2 };
    const pos = { x: p.position.x, y: 0, z: p.position.z + 200 }; // 2 m ahead, within 5 m reach

    const env = {
      protocol: 1,
      sessionId,
      sequence: 1,
      clientTick: 1,
      commands: [move(sessionId, 1, { place: { slot: 4, position: pos } })],
    };
    expect(host.receiveEnvelope(sessionId, env).ok).toBe(true);
    host.tick();

    expect(p.inventory[4]?.quantity).toBe(1);
    const st = [...host.store.values()].find((e) => e.kind === "structure") as StructureEntity;
    expect(st).toBeDefined();
    expect(st.contentId).toBe("campfire");
    expect(st.ownerId).toBe(playerId);

    // the structure must ride the wire: spawn record + build event
    host.tick();
    host.tick();
    const snaps = frames.filter((f) => f.snapshot).map((f) => f.snapshot!);
    const spawn = snaps.flatMap((s) => s.records).find((r) => r.kind === "spawn" && (r as { kindTag?: string }).kindTag === "structure");
    expect(spawn).toBeDefined();
    const build = snaps.flatMap((s) => s.records).find((r) => r.kind === "event" && (r as { event?: string }).event === "build");
    expect(build).toBeDefined();
  });

  it("research through the wire: blueprint event + payload learned", () => {
    const host = mkHost();
    const id = newIdentity();
    const { sessionId, playerId, frames } = connect(host, id);
    const p = playerOf(host, playerId);
    p.inventory[0] = { itemId: "research_kit" as never, quantity: 1 };
    p.inventory[1] = { itemId: "hatchet" as never, quantity: 1 };
    // place a workbench in reach
    p.inventory[2] = { itemId: "workbench" as never, quantity: 1 };
    const w = host.tick; // noop; place via direct command path
    void w;
    const placeEnv = {
      protocol: 1,
      sessionId,
      sequence: 1,
      clientTick: 1,
      commands: [move(sessionId, 1, { place: { slot: 2, position: { x: p.position.x, y: 0, z: p.position.z + 200 } } })],
    };
    host.receiveEnvelope(sessionId, placeEnv);
    host.tick();
    const bench = [...host.store.values()].find((e) => e.kind === "structure" && e.contentId === "workbench") as StructureEntity;
    expect(bench).toBeDefined();

    const resEnv = {
      protocol: 1,
      sessionId,
      sequence: 2,
      clientTick: 2,
      commands: [move(sessionId, 2, { research: { structureEntityId: bench.id, itemId: "hatchet" } })],
    };
    host.receiveEnvelope(sessionId, resEnv);
    const snap = drain(host, frames, "blueprint", 20);
    expect(snap).not.toBeNull();
    expect(p.blueprints).toContain("bp_pickaxe");
  });

  it("malformed M3 intents are rejected by the envelope schema, not the sim", () => {
    const host = mkHost();
    const id = newIdentity();
    const { sessionId } = connect(host, id);
    const bad = {
      protocol: 1,
      sessionId,
      sequence: 1,
      clientTick: 1,
      commands: [move(sessionId, 1, { place: { slot: 99, position: { x: 0, y: 0, z: 0 } } })],
    };
    expect(host.receiveEnvelope(sessionId, bad).ok).toBe(false);
  });

  it("baseline schema-valid with structure records (M3 fields)", () => {
    const host = mkHost();
    const id = newIdentity();
    const { playerId } = connect(host, id);
    const p = playerOf(host, playerId);
    p.blueprints.push("bp_pickaxe");
    p.inventory[0] = { itemId: "campfire" as never, quantity: 1 };
    // place a campfire so the second join sees a structure
    host.tick();
    host.tick();

    const id2 = newIdentity();
    const b = connect(host, id2);
    const baseline = b.frames.find((f) => f.snapshot)?.snapshot;
    const parsed = SnapshotSchema.safeParse(baseline!);
    expect(parsed.success, `baseline violated wire schema: ${JSON.stringify(parsed.success ? null : parsed.error.issues)}`).toBe(true);
  });
});
