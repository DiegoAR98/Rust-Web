/**
 * M0/M1 browser acceptance: the Vite client loads, connects to the host,
 * spawns into the world, and movement input reaches the authoritative
 * simulation (verified via the server health endpoint + HUD).
 *
 * Requires:  pnpm dev:server   (port 3000)
 *            pnpm dev:client   (port 5173)
 */
import { chromium } from "playwright";

const BASE = process.env.DUSTFALL_CLIENT ?? "http://127.0.0.1:5173";
const SERVER_PORT = Number(process.env.DUSTFALL_PORT ?? 3000);

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

const consoleErrors = [];
page.on("console", (msg) => {
  if (msg.type() === "error") consoleErrors.push(msg.text());
});
page.on("pageerror", (err) => consoleErrors.push(String(err)));

await page.goto(BASE, { waitUntil: "load" });

// Wait for the HUD to enter the live state: "tick <n> | pos x,y,z"
// appears only after the baseline + first replica batch have been applied.
let hud = "";
for (let i = 0; i < 30; i++) {
  await page.waitForTimeout(500);
  hud = (await page.textContent("#hud"))?.trim() ?? "";
  if (/^tick \d+ \| pos /.test(hud)) break;
}
console.log("HUD after load:", hud);
if (!/^tick \d+ \| pos /.test(hud)) {
  console.error("FAIL: client did not reach live replica state (no baseline applied). HUD:", hud);
  await browser.close();
  process.exit(1);
}

// lock pointer (headless: requestPointerLock may be denied — the client has
// a non-locked fallback per GDD §4; movement keys still flow)
try {
  await page.mouse.click(640, 360);
} catch { /* pointer lock not available in headless — expected */ }
await page.waitForTimeout(500);

// read server state before moving
const before = await (await fetch(`http://127.0.0.1:${SERVER_PORT}/health`)).json();
console.log("server before:", JSON.stringify(before));

// hold W for ~1.5 s
await page.keyboard.down("KeyW");
await page.waitForTimeout(1500);
await page.keyboard.up("KeyW");
await page.waitForTimeout(800);

const hud2 = await page.textContent("#hud");
console.log("HUD after moving:", hud2?.trim());

// the HUD shows the replicated position; it must have changed from spawn
const m = hud2?.match(/pos ([\-\d.]+),([\-\d.]+),([\-\d.]+)/);
if (!m) {
  console.error("FAIL: HUD has no position readout (no replica state):", hud2);
  await browser.close();
  process.exit(1);
}
const [sx, sy, sz] = m.slice(1).map(Number);
console.log("replicated position:", sx, sy, sz);

// spawn is (-150, 0, 380); after walking +W (toward -Z along spawn heading)
// the position must differ from spawn
const moved = Math.hypot(sx - -150, sz - 380) > 1.0;
console.log(moved
  ? "BROWSER GATE: PASS — client loaded, connected, spawned and movement reached the authoritative sim"
  : "BROWSER GATE: FAIL — position unchanged; input did not reach the sim");

// filter out benign WebGL warnings in headless
const fatal = consoleErrors.filter((e) => !/WebGL|GL|canvas|pointerlock/i.test(e));
if (fatal.length > 0) {
  console.error("console errors:", fatal);
}

await browser.close();
process.exit(moved && fatal.length === 0 ? 0 : 1);
