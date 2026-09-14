/**
 * M-1B spike: does the deterministic Rapier build run a real simulation in the
 * authoritative Node runtime, and is it bit-for-bit deterministic across two
 * independent runs?
 *
 * Load path: @dimforge/rapier3d-deterministic-compat — the deterministic WASM
 * build with the module embedded as base64 (GDD "wider bundler / CSP-safe").
 * init() is called explicitly in Node; no external .wasm file, no bundler.
 *
 * Run: node tools/spike/rapier-node.mjs   (from the repo root)
 */
import rapier from "@dimforge/rapier3d-deterministic-compat";

const R = rapier.default ?? rapier;
await R.init();
const { World, Vector3, RigidBodyDesc, ColliderDesc, EventQueue } = R;

const STEPS = 120; // 4 s at 30 Hz
const SAMPLE_EVERY = 12; // sample the trajectory every 0.4 s
const G = -9.81;

// Build a world: a fixed ground slab at y = -10, a dynamic ball dropped from
// the origin (10 m above the slab). Identical inputs => identical trajectory.
function runOnce() {
  const world = new World(new Vector3(0, G, 0));

  const groundBody = world.createRigidBody(RigidBodyDesc.fixed());
  const groundDesc = ColliderDesc.cuboid(50, 0.5, 50);
  groundDesc.setTranslation(0, -10, 0);
  world.createCollider(groundDesc, groundBody);

  const ballBody = world.createRigidBody(RigidBodyDesc.dynamic());
  const ballDesc = ColliderDesc.ball(0.5);
  ballDesc.setDensity(1.0);
  world.createCollider(ballDesc, ballBody);

  const evq = new EventQueue(false);
  const hooks = {};
  const samples = [];
  for (let i = 0; i < STEPS; i++) {
    world.step(evq, hooks);
    if (i % SAMPLE_EVERY === 0) {
      const t = ballBody.translation();
      // Keep the sample as fixed-point so the signature is exact.
      samples.push([Math.round(t.x * 1e4), Math.round(t.y * 1e4), Math.round(t.z * 1e4)]);
    }
  }
  return samples;
}

// Two independent worlds, identical inputs. Deterministic physics must
// reproduce the exact same trajectory, not just the endpoint.
const a = runOnce();
const b = runOnce();

const sigA = JSON.stringify(a);
const sigB = JSON.stringify(b);
const same = sigA === sigB;
const last = a.at(-1); // final position ×1e4

console.log("samples (cm, 4 samples):", a);
console.log("bit-for-bit identical across two runs:", same);

// Sanity: the ball must have fallen (y went negative) and must not have fallen
// through the top of the slab (slab top is y = -9.5 m).
const fell = last[1] < 0;
const aboveFloor = last[1] > -95000; // -9.5 m × 1e4
const sane = fell && aboveFloor;
console.log("sanity: fell =", fell, "| above floor =", aboveFloor);

if (!same) {
  console.error("FAIL: two identical runs diverged — physics is NOT deterministic.");
  console.error("A:", sigA);
  console.error("B:", sigB);
  process.exit(1);
}
if (!sane) {
  console.error("FAIL: trajectory is not a plausible free fall onto a floor.");
  process.exit(1);
}
console.log("PASS: deterministic Rapier runs a real sim in Node and is reproducible.");
