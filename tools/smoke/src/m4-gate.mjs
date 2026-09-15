/**
 * M4 exit-gate smoke test: "Two players build and breach the same test
 * base" (GDD §25, M4).
 *
 * Prerequisite (dev hooks enabled):
 *   DUSTFALL_DATA_DIR=$(mktemp -d) DUSTFALL_DEV_KILL=1 pnpm dev:server
 * Then:
 *   node tools/smoke/src/m4-gate.mjs
 *
 * Flow (all authoritative on the wire):
 *   P1 connects -> dev-granted build kit -> places shelter + 2 walls +
 *      storage box -> deposits wood into the box.
 *   P2 connects (second P-256 identity) -> dev-granted barricade + hatchet
 *      -> walks to the base -> WITHDRAWS the wood from P1's box -> places a
 *      barricade on the same base -> breaches P1's shelter with the
 *      hatchet until structure_destroyed + forget + the piece drops to the
 *      ground (nothing lost, GDD §21.5).
 */
import { generateKeyPairSync, sign as sign_ } from "node:crypto";
import { WebSocket } from "ws";
import { decode, encode } from "@msgpack/msgpack";

const URL = process.env.DUSTFALL_WS ?? "ws://127.0.0.1:3000";
const HTTP = "http://127.0.0.1:3000";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b64url = (b) => b.toString("base64url");
const countOf = (inv, itemId) =>
  (inv ?? []).reduce((n, s) => n + (s?.itemId === itemId ? s.quantity : 0), 0);
const slotOf = (inv, itemId) => {
  const i = (inv ?? []).findIndex((s) => s?.itemId === itemId);
  return i < 0 ? null : i;
};
const fail = (msg) => {
  console.error("M4 GATE: FAIL — " + msg);
  process.exit(1);
};
const ok = (msg) => console.log("M4 GATE: " + msg);

const devPost = async (path) => {
  const r = await fetch(HTTP + path, { method: "POST" });
  return r.json();
};

class Client {
  constructor(tag) {
    this.tag = tag;
    const kp = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    this.kp = kp;
    this.grant = null;
    this.ready = false;
    this.seq = 0;
    this.clientTick = 0;
    this.deltas = [];
    this.events = [];
    this.spawns = [];
    this.forgets = new Set();
    this.ws = new WebSocket(URL);
    this.ws.on("close", () => {});
    this.ws.on("message", (data, isBinary) => {
      if (!isBinary) {
        const m = JSON.parse(data.toString());
        if (m.kind === "challenge") {
          const sig = sign_("sha256", Buffer.from(m.nonce, "base64url"), this.kp.privateKey);
          const pub = this.kp.publicKey.export({ format: "jwk" });
          this.sendRaw({ protocol: 1, kind: "identity", sessionId: m.sessionId, publicKey: pub, signature: b64url(sig) });
        } else if (m.kind === "session_grant") this.grant = m;
      } else {
        const s = decode(data);
        for (const r of s.records) {
          if (r.kind === "delta") this.deltas.push(r);
          else if (r.kind === "event") this.events.push(r);
          else if (r.kind === "spawn") this.spawns.push(r);
          else if (r.kind === "forget") this.forgets.add(r.entityId);
        }
        if (!this.ready) {
          this.sendRaw({ protocol: 1, kind: "baseline_ack", baselineId: s.baselineId });
          this.ready = true;
        }
      }
    });
  }
  sendRaw(obj) {
    this.ws.send(encode(obj));
  }
  async connect() {
    const t0 = Date.now();
    while (!this.ready && Date.now() - t0 < 5000) await sleep(40);
    if (!this.ready) throw new Error(`${this.tag}: handshake timeout`);
    return this.grant;
  }
  move(extra = {}) {
    if (!this.ready || !this.grant) return;
    this.seq += 1;
    this.clientTick += 1;
    this.sendRaw({
      protocol: 1,
      sessionId: this.grant.sessionId,
      sequence: this.seq,
      clientTick: this.clientTick,
      commands: [{ kind: "move", wishX: 0, wishZ: 0, jump: false, crouch: false, sprint: false, inWater: false, yawHundredths: 0, pitchHundredths: 0, ...extra }],
    });
  }
  selfInv() {
    const pid = this.grant?.playerId;
    for (let i = this.deltas.length - 1; i >= 0; i--) {
      const r = this.deltas[i];
      if (r.playerId === pid && r.inventory) return r.inventory;
    }
    return null;
  }
  selfPos() {
    const pid = this.grant?.playerId;
    for (let i = this.deltas.length - 1; i >= 0; i--) {
      const r = this.deltas[i];
      if (r.playerId === pid && r.position) return r.position;
    }
    return null;
  }
  /** Spawn record for the first structure of a contentId, or null. */
  structureOf(contentId) {
    for (const s of this.spawns) if (s.kindTag === "structure" && s.contentId === contentId && !this.forgets.has(s.entityId)) return s;
    return null;
  }
  async devGrant(item, qty) {
    const r = await devPost(`/dev/grant?sessionId=${this.grant.sessionId}&item=${item}&qty=${qty}`);
    if (!r.ok) throw new Error(`${this.tag}: dev-grant ${item} failed: ${JSON.stringify(r)}`);
    return r.slot;
  }
  close() {
    this.ws.close();
  }
}

async function steer(c, tx, tz, withinCm = 150, maxMs = 60000) {
  const t0 = Date.now();
  for (let i = 0; i < 900; i++) {
    const p = c.selfPos();
    if (!p) await sleep(100);
    const dx = tx - p.x;
    const dz = tz - p.z;
    const dist = Math.hypot(dx, dz);
    if (dist <= withinCm) return p;
    const mag = dist || 1;
    c.move({ wishX: Math.round((dx / mag) * 400), wishZ: Math.round((dz / mag) * 400) });
    if (Date.now() - t0 > maxMs) return p;
    await sleep(200);
  }
  return c.selfPos();
}

/** Place the item in `slot` at `pos`; await the build event on the wire. */
async function place(c, slot, pos, tag) {
  const before = c.events.length;
  c.move({ place: { slot, position: pos }, heldSlot: 0 });
  const t0 = Date.now();
  while (Date.now() - t0 < 5000) {
    if (c.events.slice(before).some((e) => e.event === "build")) return;
    await sleep(50);
  }
  throw new Error(`${tag}: build event never arrived (placement rejected?)`);
}

/** Swing `target` until a structure_destroyed event arrives (with a swing
 *  cadence that respects the 24-tick swing cooldown). */
async function breach(c, target, tag, heldSlot, maxMs = 120000) {
  const before = c.events.length;
  const t0 = Date.now();
  let lastSwing = 0;
  while (Date.now() - t0 < maxMs) {
    if (c.events.slice(before).some((e) => e.event === "structure_destroyed" && e.entityId === target)) return;
    const now = Date.now();
    if (now - lastSwing > 900) {
      c.move({ swing: { targetEntityId: target }, heldSlot });
      lastSwing = now;
    }
    await sleep(100);
  }
  throw new Error(`${tag}: structure was never destroyed`);
}

// ---------------------------------------------------------------------------
// 1. P1 builds the test base
// ---------------------------------------------------------------------------
const p1 = new Client("P1");
await p1.connect();
ok(`${p1.tag} ready (${p1.grant.playerId.slice(0, 8)}…)`);

await p1.devGrant("wood_shelter", 1);
await p1.devGrant("wood_wall", 2);
await p1.devGrant("wood_storage_box", 1);
await p1.devGrant("wood", 10);
await p1.devGrant("hatchet", 1);
// wait until the grid arrives on the wire
for (let i = 0; i < 50 && slotOf(p1.selfInv(), "wood_shelter") === null; i++) await sleep(100);
if (slotOf(p1.selfInv(), "wood_shelter") === null) fail(`${p1.tag}: granted items never appeared in inventory`);

const inv = p1.selfInv();
const sShelter = slotOf(inv, "wood_shelter");
const sWall1 = slotOf(inv, "wood_wall");
const sBox = slotOf(inv, "wood_storage_box");
const sWood = slotOf(inv, "wood");
if ([sShelter, sWall1, sBox, sWood].some((s) => s === null)) fail(`${p1.tag}: missing a build-kit slot`);

// base layout (cm, offsets from P1's current position): all within 5 m reach, >= 2 m apart
const base = { shelter: { x: 0, z: 250 }, wall1: { x: 250, z: 250 }, wall2: { x: -250, z: 250 }, box: { x: 250, z: -250 } };
for (const [k, slot] of [["shelter", sShelter], ["wall1", sWall1], ["box", sBox]]) {
  const p0 = p1.selfPos();
  const content = k === "shelter" ? "wood_shelter" : k === "wall1" ? "wood_wall" : "wood_storage_box";
  await place(p1, slot, { x: p0.x + base[k].x, y: p0.y, z: p0.z + base[k].z }, `${p1.tag}:${k}`);
  ok(`${p1.tag} placed ${content}`);
}
// second wall (consumes the remaining wall from the same stack)
const p0b = p1.selfPos();
await place(p1, sWall1, { x: p0b.x + base.wall2.x, y: p0b.y, z: p0b.z + base.wall2.z }, `${p1.tag}:wall2`);
ok(`${p1.tag} placed 2nd wall`);

// P1 stashes 10 wood into the box (walk within 3 m storage reach first)
const boxSpawn = p1.structureOf("wood_storage_box");
if (!boxSpawn) fail(`${p1.tag}: no storage box spawn record`);
await steer(p1, boxSpawn.position.x, boxSpawn.position.z, 200, 30000);
p1.move({ deposit: { structureEntityId: boxSpawn.entityId, fromSlot: sWood, toSlot: 0 }, heldSlot: 0 });
const tD = Date.now();
let deposited = false;
while (Date.now() - tD < 5000) {
  const deltas = p1.deltas.filter((d) => d.entityId === boxSpawn.entityId && d.storage && d.storage.length > 0 && d.storage[0]);
  if (deltas.length > 0 && countOf([deltas[deltas.length - 1].storage[0]], "wood") > 0) deposited = true;
  if (deposited) break;
  await sleep(50);
}
if (!deposited) fail(`${p1.tag}: deposit never landed in the box`);
ok(`${p1.tag} stashed 10 wood in the box`);

// ---------------------------------------------------------------------------
// 2. P2 joins, takes the stash, builds on the base, breaches the shelter
// ---------------------------------------------------------------------------
const p2 = new Client("P2");
await p2.connect();
ok(`${p2.tag} ready (${p2.grant.playerId.slice(0, 8)}…)`);

await p2.devGrant("wood_barricade", 1);
await p2.devGrant("hatchet", 1);
for (let i = 0; i < 50 && slotOf(p2.selfInv(), "hatchet") === null; i++) await sleep(100);
if (slotOf(p2.selfInv(), "hatchet") === null) fail(`${p2.tag}: granted items never appeared in inventory`);
const hatchetSlot2 = slotOf(p2.selfInv(), "hatchet");

// P2 must see the whole base in their baseline
const boxSeen = p2.structureOf("wood_storage_box");
const shelterSeen = p2.structureOf("wood_shelter");
if (!boxSeen || !shelterSeen) fail(`${p2.tag}: base not replicated to the second client`);
ok(`${p2.tag} sees the base (shelter + box in baseline)`);

// walk to the box and withdraw the wood P1 stashed
await steer(p2, boxSeen.position.x, boxSeen.position.z, 250);
const inv2 = p2.selfInv();
const freeSlot = inv2.findIndex((s) => s === null || s === undefined);
if (freeSlot < 0) fail(`${p2.tag}: no free inventory slot`);
p2.move({ withdraw: { structureEntityId: boxSeen.entityId, fromSlot: 0, toSlot: freeSlot }, heldSlot: 0 });
let gotWood = false;
const tW = Date.now();
while (Date.now() - tW < 5000) {
  if (countOf(p2.selfInv(), "wood") >= 10) gotWood = true;
  if (gotWood) break;
  await sleep(50);
}
if (!gotWood) fail(`${p2.tag}: withdraw never delivered the 10 wood`);
ok(`${p2.tag} withdrew 10 wood from P1's box (shared storage)`);

// place a barricade ON the base (P2 also builds the shared base):
// 250 cm from the box (clears 2 m spacing), within 5 m reach while P2 stands
// within 200 cm of the box
const bPos = { x: boxSeen.position.x + 250, y: boxSeen.position.y, z: boxSeen.position.z };
await place(p2, slotOf(p2.selfInv(), "wood_barricade"), bPos, `${p2.tag}:barricade`);
ok(`${p2.tag} placed a barricade on the same base`);

// breach P1's shelter: hatchet is the last dev-granted item
await steer(p2, shelterSeen.position.x, shelterSeen.position.z, 200);
await breach(p2, shelterSeen.entityId, p2.tag, hatchetSlot2);
ok(`${p2.tag} breached P1's shelter`);

// conservation: the destroyed shelter drops to the ground; the entity is forgotten
const dropped = p2.spawns.some((s) => s.kindTag === "ground_item" && s.stack?.itemId === "wood_shelter");
const forgotten = p2.forgets.has(shelterSeen.entityId);
if (!dropped || !forgotten) fail(`conservation: dropped=${dropped} forgotten=${forgotten}`);
ok("conservation held: shelter body dropped, entity forgotten");

p1.close();
p2.close();
console.log("");
console.log("M4 GATE: PASS — two players built and breached the same test base");
process.exit(0);
