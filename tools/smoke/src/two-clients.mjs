/**
 * M1 exit-gate smoke test: two clients in one authoritative world.
 *
 * Run a host first:  pnpm dev:server
 * Then:              node tools/smoke/src/two-clients.mjs
 *
 * Pass condition: client 2's baseline shows client 1 at the position
 * client 1 walked to, confirming a single shared authoritative world.
 */
import { WebSocket } from "ws";
import { decode, encode } from "@msgpack/msgpack";

const URL = process.env.DUSTFALL_WS ?? "ws://127.0.0.1:3000";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function makeClient() {
  const ws = new WebSocket(URL);
  const state = { hello: null, baseline: null, deltas: [], errors: [] };
  ws.on("message", (data, isBinary) => {
    try {
      const msg = isBinary ? decode(data) : JSON.parse(data.toString());
      if (typeof msg === "string" || msg.sessionId && !("records" in msg)) {
        state.hello = msg;
        return;
      }
      if (Array.isArray(msg.records)) {
        if (!state.baseline) state.baseline = msg;
        else state.deltas.push(...msg.records.filter((r) => r.kind === "delta"));
      }
    } catch (e) {
      state.errors.push(String(e));
    }
  });
  return { ws, state };
}

// ---- client 1: connect, walk +X for ~2 s ----
const c1 = makeClient();
await new Promise((res) => c1.ws.on("open", res));
await sleep(500);
if (!c1.state.hello) {
  console.error("FAIL: no hello from server");
  process.exit(1);
}
const session1 = c1.state.hello.sessionId;
console.log(`client1 session=${session1} tick=${c1.state.hello.serverTick} world=${c1.state.hello.worldId}`);

// baseline arrives as the first binary frame
while (!c1.state.baseline && c1.state.errors.length === 0) await sleep(50);
if (!c1.state.baseline) {
  console.error("FAIL: no baseline received", c1.state.errors);
  process.exit(1);
}
const spawnRec = c1.state.baseline.records.find((r) => r.kind === "spawn");
const myEntity = spawnRec?.entityId;
const spawnX = spawnRec?.position?.x ?? 0;
console.log(`client1 baseline tick=${c1.state.baseline.serverTick} spawn=${myEntity} at x=${spawnX}`);

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
          wishX: 100,
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
await sleep(800);
if (!c2.state.baseline) {
  console.error("FAIL: client 2 got no baseline");
  process.exit(1);
}
const meInB2 = c2.state.baseline.records.find((r) => r.entityId === myEntity);
console.log(
  `client2 baseline tick=${c2.state.baseline.serverTick} sees ${myEntity} at x=${meInB2?.position?.x ?? "?"}`,
);

const pass =
  meInB2 !== undefined &&
  meInB2.position !== undefined &&
  meInB2.position.x - spawnX > 400;

console.log(pass
  ? "M1 GATE: PASS — two clients share one authoritative world; movement is replicated to a late joiner"
  : "M1 GATE: FAIL — late joiner does not see client 1's replicated position");
c1.ws.close();
c2.ws.close();
process.exit(pass ? 0 : 1);
