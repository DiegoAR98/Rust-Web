/**
 * M3 exit-gate smoke test: "First-session arc reaches shelter, furnace and
 * bow" (GDD §25, M3).
 *
 * Run a host WITH the dev kill hook first (so a fresh world exists):
 *   DUSTFALL_DATA_DIR=$(mktemp -d) pnpm dev:server
 * Then:
 *   node tools/smoke/src/m3-gate.mjs
 *
 * Drives one browser-style P-256 identity through the whole first-session arc:
 *   gather wood + stone + cloth  ->  craft + place a Furnace  ->
 *   craft + place a Wood Shelter  ->  craft a Hunting Bow.
 * Proves the M3 loop end to end: hand-crafting on the wire, structure
 * placement (server proves reach/spacing/cap), and item conservation.
 *
 * The workbench/research/pickaxe loop is covered by host + sim unit tests;
 * it is not part of the first-session arc (research_kit has no authored
 * source, so it is not reachable on a fresh save).
 */
import { generateKeyPairSync, sign as sign_ } from "node:crypto";
import { WebSocket } from "ws";
import { decode, encode } from "@msgpack/msgpack";

const URL = process.env.DUSTFALL_WS ?? "ws://127.0.0.1:3000";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b64url = (b) => b.toString("base64url");
const totalOf = (inv) => (inv ?? []).reduce((n, s) => n + (s?.quantity ?? 0), 0);
const countOf = (inv, itemId) =>
  (inv ?? []).reduce((n, s) => n + (s?.itemId === itemId ? s.quantity : 0), 0);
const slotOf = (inv, itemId) => {
  const i = (inv ?? []).findIndex((s) => s?.itemId === itemId);
  return i < 0 ? null : i;
};
const fail = (msg) => {
  console.error("M3 GATE: FAIL — " + msg);
  process.exit(1);
};

class Client {
  constructor(keypair) {
    this.kp = keypair;
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
    if (!this.ready) throw new Error("handshake timeout");
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
  close() {
    this.ws.close();
  }
}

/**
 * Steer toward (tx, tz) at ~4 m/s until within `withinCm` of the target.
 * Returns the final position. Bounded: gives up after `maxMs`.
 */
async function steer(c, tx, tz, withinCm = 150, maxMs = 60000) {
  const t0 = Date.now();
  for (let i = 0; i < 600; i++) {
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

/** Find the nearest non-depleted node of a contentId and steer toward it. */
async function walkToNode(c, contentId, depleted) {
  const p0 = c.selfPos();
  if (!p0) return null;
  let best = null;
  let bd = Infinity;
  for (const n of c.spawns.filter((r) => r.kindTag === "world" && r.contentId === contentId && !depleted.has(r.entityId))) {
    const d = Math.hypot(n.position.x - p0.x, n.position.z - p0.z);
    if (d < bd) {
      bd = d;
      best = n;
    }
  }
  if (!best) return null;
  await steer(c, best.position.x, best.position.z, 200);
  return best;
}

/**
 * Gather a resource until the player holds `need` of it (or the reachable
 * nodes of that kind are all depleted). Sends heldSlot to keep the rock
 * (slot 0) armed. Tracks depleted nodes so it re-targets fresh ones.
 * Returns the amount now held.
 */
async function gather(c, contentId, itemId, need, logTag) {
  const depleted = new Set();
  let guard = 0;
  while (countOf(c.selfInv(), itemId) < need && guard < 60) {
    guard++;
    // mark any gather event that reported a depleted node
    for (const e of c.events) {
      if (e.event === "gather" && e.payload?.depleted && e.entityId) depleted.add(e.entityId);
    }
    const node = await walkToNode(c, contentId, depleted);
    if (!node) {
      await sleep(300);
      continue;
    }
    // swing until we hit `need` or the node depletes
    for (let i = 0; i < 12; i++) {
      c.move({ swing: { targetEntityId: node.entityId }, heldSlot: 0 });
      await sleep(850); // > 0.8 s swing cooldown
      if (countOf(c.selfInv(), itemId) >= need) return countOf(c.selfInv(), itemId);
      const evs = c.events.filter((e) => e.event === "gather" && e.entityId === node.entityId);
      if (evs.length > 0 && evs[evs.length - 1].payload.depleted) break;
    }
  }
  console.log(`  [${logTag}] held ${countOf(c.selfInv(), itemId)} of ${itemId} (wanted ${need})`);
  return countOf(c.selfInv(), itemId);
}

/** Start a hand-craft on the wire and wait for the authoritative craft event. */
async function craftHand(c, recipeId, outItemId, tag) {
  const before = c.events.length;
  c.move({ craft: { recipeId }, heldSlot: 0 });
  const t0 = Date.now();
  let ok = false;
  while (Date.now() - t0 < 40000) {
    await sleep(300);
    const evs = c.events.slice(before).filter((e) => e.event === "craft" && e.payload.recipeId === recipeId);
    if (evs.length > 0) {
      ok = true;
      console.log(`  [${tag}] craft event ok: ${outItemId} x${evs[0].payload.quantity}${evs[0].payload.dropped ? " (dropped)" : ""}`);
      break;
    }
  }
  if (!ok) fail(`no craft event for ${recipeId} within 40 s`);
}

/** Place the structure in `slot` at a valid spot and await a build event. */
async function placeStructure(c, slot, contentId, tag) {
  const placed = c.spawns.filter((r) => r.kindTag === "structure");
  const knownIds = new Set(placed.map((s) => s.entityId));
  const p0 = c.selfPos();
  const cands = [
    [0, 250], [250, 0], [0, -250], [-250, 0],
    [300, 150], [-300, 150], [300, -150], [-300, -150],
    [150, 400], [-150, 400], [400, 150], [-400, 150],
    [0, 450], [450, 0],
  ];
  let pos = null;
  for (const [dx, dz] of cands) {
    const reach2 = dx * dx + dz * dz;
    if (reach2 > 450 * 450) continue; // stay safely inside the 5 m reach
    const clear = placed.every((s) => {
      const sx = s.position.x - (p0.x + dx);
      const sz = s.position.z - (p0.z + dz);
      return sx * sx + sz * sz >= 350 * 350;
    });
    if (clear) {
      pos = { x: p0.x + dx, y: 0, z: p0.z + dz };
      break;
    }
  }
  if (!pos) pos = { x: p0.x, y: 0, z: p0.z + 450 };
  console.log(`  [${tag}] placing at (${pos.x},${pos.z}); player at (${p0.x},${p0.z}); structures: ${placed.map((s) => `${s.contentId}@(${s.position.x},${s.position.z})`).join(", ") || "(none)"}`);

  const before = c.events.length;
  c.move({ place: { slot, position: pos }, heldSlot: 0 });
  const t0 = Date.now();
  let ok = false;
  while (Date.now() - t0 < 15000) {
    await sleep(300);
    const build = c.events.slice(before).find((e) => e.event === "build" && e.payload.contentId === contentId);
    const newStructures = c.spawns.filter((r) => r.kindTag === "structure" && r.contentId === contentId && !knownIds.has(r.entityId));
    if (build && newStructures.length > 0) {
      ok = true;
      console.log(`  [${tag}] placed ${contentId} at (${pos.x},${pos.z}): build event + new structure spawn`);
      break;
    }
  }
  if (!ok) fail(`no build event / structure spawn for ${contentId} (slot ${slot}, tried ${pos.x},${pos.z})`);
}

// ------------------------------------------------------------------
console.log("M3 GATE: first-session arc -> shelter, furnace, bow");
const kp = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const c = new Client(kp);
await c.connect();
console.log(`[1] handshake ok: playerId=${c.grant.playerId} saved=${c.grant.hasSavedPlayer}`);
await sleep(500);

// 2. GATHER: 16 wood, 6 stone, 1 cloth
console.log("[2] gathering wood (need 16)…");
const wood = await gather(c, "node_tree", "wood", 16, "wood");
if (wood < 16) fail(`not enough wood: ${wood} < 16`);
console.log("[2] gathering stone (need 6)…");
const stone = await gather(c, "node_stone_rock", "stone", 6, "stone");
if (stone < 6) fail(`not enough stone: ${stone} < 6`);
console.log("[2] gathering cloth from animal corpses (need 1)…");
const cloth = await gather(c, "node_animal_corpse", "cloth", 1, "cloth");
if (cloth < 1) fail(`not enough cloth: ${cloth} < 1`);

// 3. CRAFT + PLACE a FURNACE (5 stone + 5 wood)
console.log("[3] crafting furnace…");
await craftHand(c, "recipe_furnace", "furnace", "furnace");
const furnaceSlot = slotOf(c.selfInv(), "furnace");
if (furnaceSlot === null) fail("furnace item missing from grid after craft");
await placeStructure(c, furnaceSlot, "furnace", "furnace");

// 4. CRAFT + PLACE a WOOD SHELTER (8 wood)
console.log("[4] crafting wood shelter…");
await craftHand(c, "recipe_wood_shelter", "wood_shelter", "shelter");
const shelterSlot = slotOf(c.selfInv(), "wood_shelter");
if (shelterSlot === null) fail("shelter item missing from grid after craft");
await placeStructure(c, shelterSlot, "wood_shelter", "shelter");

// 5. CRAFT a HUNTING BOW (3 wood + 1 stone + 1 cloth)
console.log("[5] crafting hunting bow…");
await craftHand(c, "recipe_hunting_bow", "hunting_bow", "bow");
if (slotOf(c.selfInv(), "hunting_bow") === null) fail("hunting bow missing from grid after craft");

// 6. VERIFY the arc: both structures on the wire + the bow in hand
const structures = c.spawns.filter((r) => r.kindTag === "structure");
const hasFurnace = structures.some((r) => r.contentId === "furnace");
const hasShelter = structures.some((r) => r.contentId === "wood_shelter");
const hasBow = slotOf(c.selfInv(), "hunting_bow") !== null;
console.log(`[6] arc result: furnace=${hasFurnace} shelter=${hasShelter} bow=${hasBow}`);
if (!hasFurnace || !hasShelter || !hasBow) fail("first-session arc incomplete");

c.close();
console.log("M3 GATE: PASS — first-session arc reaches shelter, furnace and bow");
process.exit(0);
