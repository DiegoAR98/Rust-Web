/**
 * M2 gate smoke test: two M2-handshake clients share one authoritative
 * world. Client 1 walks +X; client 2 joins later and its baseline must
 * contain client 1's moved position (single shared authoritative world).
 *
 * Run a host first:  pnpm dev:server
 * Then:              node tools/smoke/src/two-clients.mjs
 */
import { generateKeyPairSync, sign as sign_ } from "node:crypto";
import { WebSocket } from "ws";
import { decode, encode } from "@msgpack/msgpack";

const URL = process.env.DUSTFALL_WS ?? "ws://127.0.0.1:3000";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b64url = (b) => b.toString("base64url");

function makeClient() {
  const kp = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const ws = new WebSocket(URL);
  const state = { grant: null, baseline: null, deltas: [], errors: [] };
  ws.on("message", (data, isBinary) => {
    try {
      if (!isBinary) {
        const m = JSON.parse(data.toString());
        if (m.kind === "challenge") {
          const sig = sign_("sha256", Buffer.from(m.nonce, "base64url"), kp.privateKey);
          const pub = kp.publicKey.export({ format: "jwk" });
          ws.send(encode({ protocol: 1, kind: "identity", sessionId: m.sessionId, publicKey: pub, signature: b64url(sig) }));
        } else if (m.kind === "session_grant") {
          state.grant = m;
        }
        return;
      }
      const s = decode(data);
      if (!state.baseline) {
        state.baseline = s;
        // M2 handshake: ack the baseline so the session reaches Ready
        ws.send(encode({ protocol: 1, kind: "baseline_ack", baselineId: s.baselineId }));
      }
      for (const r of s.records) if (r.kind === "delta") state.deltas.push(r);
    } catch (e) {
      state.errors.push(String(e));
    }
  });
  return { ws, state, session() { return state.grant?.sessionId; } };
}

// ---- client 1: connect, walk +X for ~2 s ----
const c1 = makeClient();
await new Promise((res) => c1.ws.on("open", res));
while (!c1.state.grant && c1.state.errors.length === 0) await sleep(50);
if (!c1.state.grant) {
  console.error("FAIL: no session grant", c1.state.errors);
  process.exit(1);
}
while (!c1.state.baseline && c1.state.errors.length === 0) await sleep(50);
if (!c1.state.baseline) {
  console.error("FAIL: no baseline received", c1.state.errors);
  process.exit(1);
}
console.log(`client1 player=${c1.state.grant.playerId} baseline tick=${c1.state.baseline.serverTick}`);

const session1 = c1.state.grant.sessionId;
let seq = 0;
const timer = setInterval(() => {
  seq += 1;
  c1.ws.send(
    encode({
      protocol: 1,
      sessionId: session1,
      sequence: seq,
      clientTick: seq,
      commands: [
        {
          kind: "move",
          wishX: 400,
          wishZ: 0,
          jump: false,
          crouch: false,
          sprint: false,
          inWater: false,
          yawHundredths: 0,
          pitchHundredths: 0,
        },
      ],
    }),
  );
}, 33);

// client1's spawn position (from the baseline, matched by its playerId)
const me1 = c1.state.baseline.records.find((r) => r.kind === "spawn" && r.kindTag === "player" && r.playerId === c1.state.grant.playerId);
const myEntity = me1?.entityId;
const spawnX = me1?.position?.x ?? 0;
console.log(`client1 spawn ${myEntity} at x=${spawnX}`);

await sleep(2200);
clearInterval(timer);
await sleep(700);

// client1's own replicated position
const mine = c1.state.deltas.filter((d) => d.entityId === myEntity && d.position);
const lastMine = mine[mine.length - 1];
console.log(`client1 walked to x=${lastMine?.position?.x ?? "?"} (from ${spawnX}, ${mine.length} deltas)`);
if (!lastMine || lastMine.position.x - spawnX < 400) {
  console.error("FAIL: client 1 did not move in its own replica");
  process.exit(1);
}

// ---- client 2: joins mid-game; baseline must contain client 1's new position ----
const c2 = makeClient();
await new Promise((res) => c2.ws.on("open", res));
while (!c2.state.grant && c2.state.errors.length === 0) await sleep(50);
while (!c2.state.baseline && c2.state.errors.length === 0) await sleep(50);
if (!c2.state.baseline) {
  console.error("FAIL: client 2 got no baseline", c2.state.errors);
  process.exit(1);
}
const meInB2 = c2.state.baseline.records.find((r) => r.entityId === myEntity);
console.log(`client2 baseline tick=${c2.state.baseline.serverTick} sees ${myEntity} at x=${meInB2?.position?.x ?? "?"}`);

const pass = meInB2 !== undefined && meInB2.position !== undefined && meInB2.position.x - spawnX > 400;

console.log(pass
  ? "M2 GATE: PASS — two clients share one authoritative world; movement is replicated to a late joiner"
  : "M2 GATE: FAIL — late joiner does not see client 1's replicated position");
c1.ws.close();
c2.ws.close();
process.exit(pass ? 0 : 1);
