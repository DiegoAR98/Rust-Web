/**
 * Persistence integration (GDD §21): the host serializes its live world
 * through WorldRepository and a fresh host restores it — no item
 * duplication, no entity id collision, clock and loot intact.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateKeyPairSync, sign as cryptoSign } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { WorldRepository } from "@dustfall/persistence";
import type { JwkProto } from "@dustfall/protocol";
import {
  commitDeath,
  dropToGround,
  placeStructure,
  type PlayerEntity,
  type WorldEntity,
  type CorpseEntity,
  type GroundItemEntity,
  type StructureEntity,
} from "@dustfall/sim";
import { Host } from "../src/host.js";

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

const connectAndReady = (host: Host): { sessionId: string; playerId: string } => {
  const id = newIdentity();
  const hs = host.beginHandshake();
  host.attachWriter(hs.sessionId, () => {});
  const r = host.submitIdentity(hs.sessionId, { kind: "identity", sessionId: hs.sessionId, publicKey: id.jwk, signature: id.signNonce(hs.nonce) });
  if (!r.ok) throw new Error(`handshake failed: ${r.reason}`);
  host.ackBaseline(hs.sessionId, { kind: "baseline_ack", protocol: 1, baselineId: host.sessions.get(hs.sessionId)?.baselineId ?? 0 });
  return { sessionId: hs.sessionId, playerId: r.grant.playerId };
};

describe("host <-> WorldRepository round-trip (GDD 21)", () => {
  const dirs: string[] = [];
  afterAll(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  });

  const repoFor = (): WorldRepository => {
    const dir = mkdtempSync(join(tmpdir(), "dustfall-persist-"));
    dirs.push(dir);
    return new WorldRepository(join(dir, "world_test.db"));
  };

  it("saves a live world and restores it on a fresh host without duplication", () => {
    const repo = repoFor();
    const host = new Host("test_server", "world_persist", 0x1, 0x2, 8);
    const { playerId } = connectAndReady(host);

    for (let i = 0; i < 20; i++) host.tick();

    const p = [...host.store.values()].find((e) => e.kind === "player" && e.playerId === playerId) as PlayerEntity;
    p.inventory[10] = { itemId: "wood", quantity: 33 };
    const node = [...host.store.values()].find((e) => e.kind === "world") as WorldEntity;
    node.pool = 3;
    node.accumulator = 0.7;

    const doc = host.toSaveDocument();
    repo.save(doc);

    const host2 = new Host("test_server", "world_persist", 0x1, 0x2, 8);
    const restored = repo.load();
    expect(restored).not.toBeNull();
    host2.restoreFromSave(restored!);

    expect(host2.world.clock.tick).toBe(doc.clock.tick);
    const node2 = host2.store.get(node.id) as WorldEntity;
    expect(node2.pool).toBe(3);
    expect(node2.accumulator).toBe(0.7);

    const p2 = [...host2.store.values()].find((e) => e.kind === "player" && e.playerId === playerId) as PlayerEntity;
    expect(p2.inventory[10]).toMatchObject({ itemId: "wood", quantity: 33 });
    const woodBefore = p.inventory.reduce((n, s) => n + (s && s.itemId === "wood" ? s.quantity : 0), 0);
    const woodAfter = p2.inventory.reduce((n, s) => n + (s && s.itemId === "wood" ? s.quantity : 0), 0);
    expect(woodAfter).toBe(woodBefore);

    const worldCount = [...host2.store.values()].filter((e) => e.kind === "world").length;
    expect(worldCount).toBe([...host.store.values()].filter((e) => e.kind === "world").length);
  });

  it("restores a corpse and its loot exactly once", () => {
    const repo = repoFor();
    const host = new Host("test_server", "world_persist", 0x1, 0x2, 8);
    const { playerId } = connectAndReady(host);
    for (let i = 0; i < 10; i++) host.tick();
    const p = [...host.store.values()].find((e) => e.kind === "player" && e.playerId === playerId) as PlayerEntity;
    p.inventory[0] = { itemId: "stone", quantity: 5 };
    p.dead = true;
    const tx = commitDeath(host.world, host.store, p);
    expect(tx).not.toBeNull();
    const corpse = host.store.get(tx!.corpseEntityId) as CorpseEntity;
    // 5 stone + the 5 starter-kit items = 10 total
    expect(corpse.inventory.reduce((n, s) => n + (s?.quantity ?? 0), 0)).toBe(10);

    repo.save(host.toSaveDocument());
    const host2 = new Host("test_server", "world_persist", 0x1, 0x2, 8);
    host2.restoreFromSave(repo.load()!);

    const corpse2 = host2.store.get(corpse.id) as CorpseEntity;
    expect(corpse2.inventory.reduce((n, s) => n + (s?.quantity ?? 0), 0)).toBe(10);
    const p2 = [...host2.store.values()].find((e) => e.kind === "player" && e.playerId === playerId) as PlayerEntity;
    expect(p2).toBeDefined();
  });

  it("restores a ground item stack and its despawn timer", () => {
    const repo = repoFor();
    const host = new Host("test_server", "world_persist", 0x1, 0x2, 8);
    const { playerId } = connectAndReady(host);
    for (let i = 0; i < 6; i++) host.tick();
    const p = [...host.store.values()].find((e) => e.kind === "player" && e.playerId === playerId) as PlayerEntity;
    p.inventory[15] = { itemId: "cloth", quantity: 20 };
    const dr = dropToGround(host.world, host.store, p, 15);
    expect(dr.ok).toBe(true);
    const ground = [...host.store.values()].find((e) => e.kind === "ground_item") as GroundItemEntity;
    expect(ground.stack.quantity).toBe(20);

    repo.save(host.toSaveDocument());
    const host2 = new Host("test_server", "world_persist", 0x1, 0x2, 8);
    host2.restoreFromSave(repo.load()!);
    const ground2 = host2.store.get(ground.id) as GroundItemEntity;
    expect(ground2.stack.quantity).toBe(20);
    expect(ground2.despawnAtTick).toBe(ground.despawnAtTick);
  });

  it("a fresh host after restore allocates new ids that never collide with restored ones", () => {
    const repo = repoFor();
    const host = new Host("test_server", "world_persist", 0x1, 0x2, 8);
    const a = connectAndReady(host);
    for (let i = 0; i < 6; i++) host.tick();
    repo.save(host.toSaveDocument());

    const host2 = new Host("test_server", "world_persist", 0x1, 0x2, 8);
    host2.restoreFromSave(repo.load()!);
    // a second player connects on the restored host; its fresh entity id
    // must not collide with any restored id
    const b = connectAndReady(host2);
    const pB = [...host2.store.values()].find((e) => e.kind === "player" && e.playerId === b.playerId) as PlayerEntity;
    const pA = [...host2.store.values()].find((e) => e.kind === "player" && e.playerId === a.playerId) as PlayerEntity;
    expect(pA.id).not.toBe(pB.id);
    expect(host2.store.get(pB.id)?.kind).toBe("player");
  });

  it("restores structures: position, owner, hp and an in-progress station craft", () => {
    const repo = repoFor();
    const host = new Host("test_server", "world_persist", 0x1, 0x2, 8);
    const { playerId } = connectAndReady(host);
    for (let i = 0; i < 5; i++) host.tick();
    const p = [...host.store.values()].find((e) => e.kind === "player" && e.playerId === playerId) as PlayerEntity;
    p.inventory[0] = { itemId: "campfire", quantity: 1 };
    p.inventory[1] = { itemId: "workbench", quantity: 1 };
    const pr = placeStructure(host.world, host.store, p, 0, { x: p.position.x, y: 0, z: p.position.z + 200 });
    expect(pr.ok).toBe(true);
    const br = placeStructure(host.world, host.store, p, 1, { x: p.position.x, y: 0, z: p.position.z + 400 });
    expect(br.ok).toBe(true);
    const fire = host.store.get(pr.structureEntityId!) as StructureEntity;
    fire.hp = 480; // partially damaged
    // an active station craft on the workbench, materials already paid
    const bench = host.store.get(br.structureEntityId!) as StructureEntity;
    bench.craft = { recipeId: "recipe_campfire", completesAtTick: host.world.clock.tick + 50, startedBy: playerId };

    repo.save(host.toSaveDocument());
    const host2 = new Host("test_server", "world_persist", 0x1, 0x2, 8);
    host2.restoreFromSave(repo.load()!);

    const fire2 = host2.store.get(pr.structureEntityId!) as StructureEntity;
    expect(fire2.contentId).toBe("campfire");
    expect(fire2.ownerId).toBe(playerId);
    expect(fire2.hp).toBe(480);
    expect(fire2.position).toEqual(fire.position);
    const bench2 = host2.store.get(br.structureEntityId!) as StructureEntity;
    expect(bench2.craft?.recipeId).toBe("recipe_campfire");
    expect(bench2.craft?.completesAtTick).toBe(bench.craft?.completesAtTick);
    expect(bench2.craft?.startedBy).toBe(playerId);
  });

  it("restores learned blueprints on the player", () => {
    const repo = repoFor();
    const host = new Host("test_server", "world_persist", 0x1, 0x2, 8);
    const { playerId } = connectAndReady(host);
    for (let i = 0; i < 3; i++) host.tick();
    const p = [...host.store.values()].find((e) => e.kind === "player" && e.playerId === playerId) as PlayerEntity;
    p.blueprints.push("bp_pickaxe");

    repo.save(host.toSaveDocument());
    const host2 = new Host("test_server", "world_persist", 0x1, 0x2, 8);
    host2.restoreFromSave(repo.load()!);
    const p2 = [...host2.store.values()].find((e) => e.kind === "player" && e.playerId === playerId) as PlayerEntity;
    expect(p2.blueprints).toContain("bp_pickaxe");
  });
});
