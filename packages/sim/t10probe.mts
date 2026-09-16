
import { createWorld, newPlayer, EntityStore, resolveFire, advanceClock, poseAtTick, aimDirection } from "@dustfall/sim";
const aimAt = (shooter, target, serverTick) => {
  const ox = shooter.position.x, oy = shooter.position.y + 120, oz = shooter.position.z;
  const dx = target.x - ox, dy = target.y + 80 - oy, dz = target.z - oz;
  const yawHundredths = Math.round((Math.atan2(dx, dz) * 180) / Math.PI * 100);
  const pitchHundredths = Math.round((Math.atan2(dy, Math.hypot(dx, dz)) * 180) / Math.PI * 100);
  return { serverTick, yawHundredths, pitchHundredths };
};
const world = createWorld("m6", 0x6666, 0x0f00);
const store = new EntityStore();
const p = newPlayer(store.allocate(), "t10_s", { x: 0, y: 0, z: 0 });
p.inventory[0] = { itemId: "nine_mm_pistol", quantity: 1 };
p.inventory[1] = { itemId: "nine_mm_round", quantity: 10 };
p.heldItemId = "nine_mm_pistol";
p.weapon.loadedByItemId["nine_mm_pistol"] = 8;
store.insert(p);
p.poseHistory.record(world.clock.tick, p.position);
const victim = newPlayer(store.allocate(), "t10_v", { x: 0, y: 0, z: 2000 });
store.insert(victim);
victim.poseHistory.record(world.clock.tick, victim.position);
advanceClock(world);
victim.position = { x: 1000, y: 0, z: 2000 };
const aim = aimAt(p, { x: 0, y: 0, z: 2000 }, 0);
console.log("aim:", JSON.stringify(aim));
const r = resolveFire(world, store, p, 0, aim, {});
console.log("ok:", r.ok, "reason:", r.reason, "hits:", r.hits.length);
console.log("aimDir:", JSON.stringify(aimDirection(aim.yawHundredths, aim.pitchHundredths)));
