/**
 * M5 exit-gate smoke test (GDD §25, M5): "60-minute day and radiation
 * acceptance suite pass".
 *
 * Prerequisite (dev hooks enabled):
 *   DUSTFALL_DATA_DIR=$(mktemp -d) DUSTFALL_DEV_KILL=1 pnpm dev:server
 * Then:
 *   pnpm --filter @dustfall/smoke m5-gate
 *
 * The literal 60-minute day (T01: 108,000 ticks = 24 game hours) and the
 * radiation dose acceptance suite (T03/T04) are deterministic simulation
 * tests in packages/sim/test/m5.test.ts and run under `pnpm test`. This
 * smoke gate proves the M5 systems are LIVE on the authoritative wire with
 * a real connected client:
 *
 *   1. 60-minute day clock: the server runs the ADR-0004 24× clock
 *      (108,000 ticks = 1 day); the replica serverTick advances at ~30
 *      ticks/real-second between two samples.
 *   2. Weather: the baseline + batches carry a valid weather state.
 *   3. Radiation: the baseline + batches carry a finite radiation value for
 *      the joining player (spawn beach is outside every zone, so 0 is the
 *      correct value here — the dose-rate acceptance is the unit suite).
 *   4. Wildlife: animals spawn on the wire, and a real client can hunt the
 *      nearest one to death — animal_hit(killed) + its loot drops to the
 *      ground as a ground_item spawn (GDD §12: prey flees, hostiles attack).
 *   5. Channels: a food channel completes end-to-end — channel_done event +
 *      the granted stack decrements by exactly one (GDD §6).
 */
import { generateKeyPairSync, sign as sign_ } from "node:crypto";
import { WebSocket } from "ws";
import { decode, encode } from "@msgpack/msgpack";

const URL = process.env.DUSTFALL_WS ?? "ws://127.0.0.1:3000";
const HTTP = "http://127.0.0.1:3000";
const WEATHER_STATES = ["clear", "overcast", "rain", "fog", "dry_wind"];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b64url = (b) => b.toString("base64url");
const countOf = (inv, itemId) => (inv ?? []).reduce((n, s) => n + (s?.itemId === itemId ? s.quantity : 0), 0);
const slotOf = (inv, itemId) => {
  const i = (inv ?? []).findIndex((s) => s?.itemId === itemId);
  return i < 0 ? null : i;
};
const fail = (msg) => {
  console.error("M5 GATE: FAIL — " + msg);
  process.exit(1);
};
const ok = (msg) => console.log("M5 GATE: " + msg);

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
    this.lastSnapshot = null;
    this.weather = null;
    this.radiation = null;
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
        this.lastSnapshot = s;
        if (typeof s.weather === "string") this.weather = s.weather;
        if (typeof s.radiation === "number") this.radiation = s.radiation;
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
      commands: [
        { kind: "move", wishX: 0, wishZ: 0, jump: false, crouch: false, sprint: false, inWater: false, yawHundredths: 0, pitchHundredths: 0, ...extra },
      ],
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
  /** Live animal map from the wire: entityId -> { x, z, contentId, hp, maxHp }. */
  animals() {
    const m = new Map();
    for (const s of this.spawns) if (s.kindTag === "animal") m.set(s.entityId, { x: s.position.x, z: s.position.z, contentId: s.contentId, hp: s.hp, maxHp: s.maxHp });
    for (const d of this.deltas) {
      if (!d.position && d.hp === undefined) continue;
      const cur = m.get(d.entityId);
      if (cur) {
        if (d.position) {
          cur.x = d.position.x;
          cur.z = d.position.z;
        }
        if (d.hp !== undefined) cur.hp = d.hp;
      }
    }
    for (const id of this.forgets) m.delete(id);
    return m;
  }
  nearestAnimal() {
    const p = this.selfPos();
    if (!p) return null;
    let best = null;
    let bestD = Infinity;
    for (const [id, a] of this.animals()) {
      const d = (a.x - p.x) ** 2 + (a.z - p.z) ** 2;
      if (d < bestD) {
        bestD = d;
        best = { id, ...a, d: Math.sqrt(bestD) };
      }
    }
    return best;
  }
  async devGrant(item, qty) {
    const r = await fetch(`${HTTP}/dev/grant?sessionId=${this.grant.sessionId}&item=${item}&qty=${qty}`, { method: "POST" });
    const j = await r.json();
    if (!j.ok) throw new Error(`${this.tag}: dev-grant ${item} failed: ${JSON.stringify(j)}`);
    return j.slot;
  }
  close() {
    this.ws.close();
  }
}

async function steer(c, tx, tz, withinCm, maxMs = 60000) {
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

// ---------------------------------------------------------------------------
const c = new Client("P1");
await c.connect();
ok(`${c.tag} connected (${c.grant.playerId.slice(0, 8)}…)`);

// 1. 60-minute day clock: the server tick advances at ~30 ticks/real-second
const tickA = c.lastSnapshot?.serverTick;
await sleep(2000);
const tickB = c.lastSnapshot?.serverTick;
if (typeof tickA !== "number" || typeof tickB !== "number" || tickB <= tickA) fail(`clock did not advance (${tickA} -> ${tickB})`);
const perSec = (tickB - tickA) / 2;
if (perSec < 20 || perSec > 45) fail(`clock rate off: ~${perSec.toFixed(1)} ticks/real-sec (expect ~30 for the 24× day clock)`);
ok(`day clock live: ${tickB - tickA} ticks in 2 s ≈ ${perSec.toFixed(1)}/s (108,000 ticks = 1 day, ADR-0004)`);

// 2. Weather on the wire
if (!c.weather || !WEATHER_STATES.includes(c.weather)) fail(`weather missing or invalid: ${c.weather}`);
ok(`weather on the wire: ${c.weather}`);

// 3. Radiation on the wire (spawn beach is outside every zone -> 0 expected)
if (typeof c.radiation !== "number" || !Number.isFinite(c.radiation) || c.radiation < 0 || c.radiation > 500) fail(`radiation invalid on wire: ${c.radiation}`);
ok(`radiation on the wire: ${c.radiation} (spawn is outside all zones; dose acceptance = m5.test.ts T03/T04)`);

// 4. Wildlife: animals spawn on the wire, then hunt the nearest to death
let sawAnimal = false;
for (let i = 0; i < 100 && !sawAnimal; i++) {
  if (c.spawns.some((s) => s.kindTag === "animal")) sawAnimal = true;
  else await sleep(100);
}
if (!sawAnimal) fail("no animal spawn record ever arrived on the wire");
ok(`wildlife replicated: ${c.spawns.filter((s) => s.kindTag === "animal").length} animal spawn(s) on the wire`);

// hunt: steer to the nearest animal, keep swinging until it dies and its loot
// drops to the ground. We track which animal-loot item ids are already on the
// wire at hunt start; a new one appearing is the kill (avoids the batch
// ordering race where the ground_item spawn lands before the animal_hit event).
const ANIMAL_LOOT = new Set([
  "raw_rabbit_meat", "raw_chicken_meat", "raw_venison", "raw_wolf_meat",
  "cloth", "leather", "animal_fat",
]);
const groundLootIds = () => c.spawns.filter((s) => s.kindTag === "ground_item").map((s) => s.stack?.itemId);
const lootIdsAtStart = new Set(groundLootIds());
let huntedId = null;
let killed = false;
let newLoot = null;
const t0 = Date.now();
let lastSwing = 0;
while (Date.now() - t0 < 120000) {
  // re-evaluate the target each pass (prey flees; a fresh animal may be nearer)
  const target = c.nearestAnimal();
  if (!target) {
    await sleep(150);
    continue;
  }
  if (target.d <= 280) {
    const now = Date.now();
    if (now - lastSwing > 850) {
      c.move({ swing: { targetEntityId: target.id }, heldSlot: 0 });
      lastSwing = now;
      huntedId = target.id;
    }
  } else {
    await steer(c, target.x, target.z, 260, 1000);
  }
  for (let i = c.events.length - 1; i >= 0; i--) {
    const e = c.events[i];
    if (e.event === "animal_hit" && e.payload?.killed === true) killed = true;
  }
  for (const id of groundLootIds()) {
    if (ANIMAL_LOOT.has(id) && !lootIdsAtStart.has(id)) {
      newLoot = id;
      break;
    }
  }
  if (killed && newLoot) break;
  await sleep(120);
}
if (!killed) fail("no animal was ever killed (animal_hit killed=true never arrived)");
if (!newLoot) fail("killed animal dropped no new loot to the ground");
ok(`hunted ${huntedId} to death: animal_hit(killed) + new loot ${newLoot} dropped to the ground`);

// 5. Food channel end-to-end: grant cooked meat, channel it, watch it complete
await c.devGrant("cooked_rabbit_meat", 1);
for (let i = 0; i < 50 && slotOf(c.selfInv(), "cooked_rabbit_meat") === null; i++) await sleep(100);
const meatSlot = slotOf(c.selfInv(), "cooked_rabbit_meat");
if (meatSlot === null) fail("granted cooked meat never appeared in inventory");
const meatCount0 = countOf(c.selfInv(), "cooked_rabbit_meat");
c.move({ channel: { slot: meatSlot, kind: "food" }, heldSlot: 0 });
let chDone = false;
const tC = Date.now();
while (Date.now() - tC < 6000) {
  if (c.events.some((e) => e.event === "channel_done" && e.payload?.playerId === c.grant.playerId && e.payload?.kind === "food")) chDone = true;
  else await sleep(50);
}
if (!chDone) fail("food channel never completed (channel_done not on the wire)");
for (let i = 0; i < 40 && countOf(c.selfInv(), "cooked_rabbit_meat") !== meatCount0 - 1; i++) await sleep(50);
if (countOf(c.selfInv(), "cooked_rabbit_meat") !== meatCount0 - 1) fail(`food not consumed exactly once (was ${meatCount0}, now ${countOf(c.selfInv(), "cooked_rabbit_meat")})`);
ok(`food channel complete: channel_done on the wire + stack ${meatCount0} -> ${countOf(c.selfInv(), "cooked_rabbit_meat")}`);

c.close();
console.log("");
console.log("M5 GATE: PASS — 24× day clock live, weather + radiation on the wire, wildlife hunted to death with loot dropped, food channel complete");
process.exit(0);
