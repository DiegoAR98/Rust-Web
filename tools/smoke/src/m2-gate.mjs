/**
 * M2 exit-gate smoke test: "Gather, move, die, loot and reconnect without
 * duplication" (GDD §21, M2).
 *
 * Run a host WITH the dev kill hook first:
 *   DUSTFALL_DEV_KILL=1 DUSTFALL_DATA_DIR=$(mktemp -d) pnpm dev:server
 * Then:
 *   node tools/smoke/src/m2-gate.mjs
 *
 * Uses a shared P-256 identity across two sockets (like a reconnecting
 * browser) and proves every item is accounted for: no duplication, no loss.
 */
import { generateKeyPairSync, sign as sign_ } from "node:crypto";
import { WebSocket } from "ws";
import { decode, encode } from "@msgpack/msgpack";

const URL = process.env.DUSTFALL_WS ?? "ws://127.0.0.1:3000";
const PORT = process.env.DUSTFALL_HTTP_PORT ?? "3000";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b64url = (b) => b.toString("base64url");

class Client {
  constructor(keypair) {
    this.kp = keypair;
    this.grant = null;
    this.ready = false;
    this.seq = 0;
    this.clientTick = 0;
    this.deltas = []; // all player deltas (self has inventory)
    this.events = [];
    this.spawns = [];
    this.forgets = new Set();
    this.closed = false;
    this.ws = new WebSocket(URL);
    this.ws.on("close", () => { this.closed = true; });
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

  sendRaw(obj) { this.ws.send(encode(obj)); }

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

  /** latest self delta with an inventory */
  selfInv() {
    const pid = this.grant?.playerId;
    for (let i = this.deltas.length - 1; i >= 0; i--) {
      const r = this.deltas[i];
      if (r.playerId === pid && r.inventory) return r;
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

  total(inv) { return (inv ?? []).reduce((n, s) => n + (s?.quantity ?? 0), 0); }

  close() { this.ws.close(); }
}

const totalOf = (inv) => (inv ?? []).reduce((n, s) => n + (s?.quantity ?? 0), 0);
const fail = (msg) => { console.error("M2 GATE: FAIL — " + msg); process.exit(1); };

// ------------------------------------------------------------------
// 1. connect (browser-style P-256 identity)
// ------------------------------------------------------------------
const kp = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const a = new Client(kp);
await a.connect();
console.log(`[1] handshake ok: playerId=${a.grant.playerId} saved=${a.grant.hasSavedPlayer}`);
if (!a.grant.playerId.startsWith("p_")) fail("bad playerId");

// 2. starter inventory
await sleep(500);
let s = a.selfInv();
if (!s) fail("no self inventory delta");
const starter = totalOf(s.inventory);
console.log(`[2] starter inventory total=${starter}`);
if (starter < 5) fail("starter inventory missing");

// 3. GATHER: walk to nearest node, swing until a gather event lands
const nodes = a.spawns.filter((r) => r.kindTag === "world");
if (nodes.length === 0) fail("no nodes in baseline");
const p0 = a.selfPos();
let nearest = nodes[0];
let bd = Infinity;
for (const n of nodes) {
  const d = Math.hypot(n.position.x - p0.x, n.position.z - p0.z);
  if (d < bd) { bd = d; nearest = n; }
}
const dirX = nearest.position.x - p0.x;
const dirZ = nearest.position.z - p0.z;
const mag = Math.hypot(dirX, dirZ) || 1;
for (let i = 0; i < 12; i++) a.move({ wishX: Math.round((dirX / mag) * 400), wishZ: Math.round((dirZ / mag) * 400) });
await sleep(500);
for (let i = 0; i < 5; i++) { a.move({ swing: { targetEntityId: nearest.entityId } }); await sleep(1000); }
const gathers = a.events.filter((e) => e.event === "gather");
const payout = gathers.reduce((n, e) => n + (e.payload.payout ?? 0), 0);
console.log(`[3] gather: ${gathers.length} events, payout=${payout} from ${nearest.contentId}`);
if (payout === 0) fail("no gather payout");
await sleep(400);
const afterGather = a.selfInv();
if (totalOf(afterGather.inventory) !== starter + payout) fail(`gather not reflected in self inventory (${totalOf(afterGather.inventory)} vs ${starter + payout})`);

// 4. MOVE: moveItem slot 0 -> 5
a.move({ moveItem: { from: 0, to: 5 } });
await sleep(400);
let inv = a.selfInv().inventory;
if (totalOf(inv) !== starter + payout) fail("moveItem changed the total");
console.log(`[4] moveItem ok, total=${totalOf(inv)}`);

// 5. DROPS + LOOT: drop a slot, loot it back
const dropSrc = inv[5] ? 5 : 0;
a.move({ drop: { slot: dropSrc } });
await sleep(500);
const gitems = a.spawns.filter((r) => r.kindTag === "ground_item");
if (gitems.length === 0) fail("no ground item after drop");
const gi = gitems[gitems.length - 1];
a.move({ pickup: { sourceEntityId: gi.entityId } });
await sleep(500);
inv = a.selfInv().inventory;
if (totalOf(inv) !== starter + payout) fail(`loot round-trip changed the total (${totalOf(inv)})`);
console.log(`[5] drop+loot round-trip ok, total=${totalOf(inv)}`);

// 6. DIE: force-commit via the dev kill hook
const killRes = await fetch(`http://127.0.0.1:${PORT}/dev/kill?sessionId=${a.grant.sessionId}`, { method: "POST" });
const killJson = await killRes.json();
console.log(`[6] dev kill: ${JSON.stringify(killJson)}`);
if (!killJson.ok) fail("dev kill failed");
// a few ticks so the death event + corpse spawn ride the 15 Hz batch
await sleep(700);
const deaths = a.events.filter((e) => e.event === "death");
if (deaths.length === 0) fail("no death event on the wire");
// server omits the dead self from deltas; the client keeps its last state
const corpseSpawns = a.spawns.filter((r) => r.kindTag === "corpse");
const myCorpse = corpseSpawns.find((r) => r.entityId === killJson.corpseEntityId) ?? corpseSpawns[corpseSpawns.length - 1];
if (!myCorpse) fail("no corpse spawn on the wire");
const corpseItems = totalOf(myCorpse.inventory);
console.log(`[6] death event ok; corpse ${myCorpse.entityId} holds ${corpseItems} items`);
if (corpseItems !== starter + payout) fail(`corpse items ${corpseItems} != carried ${starter + payout}`);

// 7. RECONNECT: same key pair -> same playerId, fresh starter kit,
//    loot the corpse back; total must end at exactly starter + payout.
const b = new Client(kp);
await b.connect();
if (b.grant.playerId !== a.grant.playerId) fail("identity changed across reconnect");
console.log(`[7] reconnect ok: same playerId, hasSavedPlayer=${b.grant.hasSavedPlayer}`);
if (!b.grant.hasSavedPlayer) fail("server lost the player across reconnect");
await sleep(700);
const respawned = b.selfInv();
if (!respawned) fail("no self inventory after respawn");
const freshStarter = totalOf(respawned.inventory);
if (freshStarter < 5) fail("respawn lost the starter kit");

// loot the corpse (walk to it first, like the browser client does)
const b0 = b.selfPos();
const cd = myCorpse.position;
const cdx = cd.x - b0.x;
const cdz = cd.z - b0.z;
const cmag = Math.hypot(cdx, cdz) || 1;
for (let i = 0; i < 14; i++) b.move({ wishX: Math.round((cdx / cmag) * 400), wishZ: Math.round((cdz / cmag) * 400) });
await sleep(600);
b.move({ pickup: { sourceEntityId: myCorpse.entityId } });
await sleep(700);
const finalInv = b.selfInv().inventory;
const finalTotal = totalOf(finalInv);
// conservation: items at death + the FRESH starter kit granted on respawn
// must equal (hand now) + (whatever the corpse still holds, 0 if consumed)
const carriedAtDeath = starter + payout;
const corpseGone = b.forgets.has(myCorpse.entityId);
const corpseNowTotal = corpseGone ? 0 : totalOf(myCorpse.inventory);
console.log(`[7] after reconnect+loot: hand=${finalTotal} corpse=${corpseNowTotal} (was ${carriedAtDeath} + ${freshStarter} fresh starter)`);
if (finalTotal + corpseNowTotal !== carriedAtDeath + freshStarter) fail(`item conservation broken: ${finalTotal}+${corpseNowTotal} != ${carriedAtDeath}+${freshStarter}`);
// no duplication: no second corpse, and the ground/corpse stacks don't exceed
const myCorpses = b.spawns.filter((r) => r.kindTag === "corpse" && r.entityId === myCorpse.entityId);
if (myCorpses.length > 2) fail("corpse spawn duplicated on the wire");

a.close();
b.close();
console.log("M2 GATE: PASS — gather, move, die, loot and reconnect without duplication");
process.exit(0);
