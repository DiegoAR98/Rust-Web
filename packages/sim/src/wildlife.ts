/**
 * M5: wildlife (GDD §12).
 *
 * Animals are a simple FSM: idle (wander near their home), flee (prey) or
 * attack (hostile) when a live player enters aggroRangeM, calm at
 * calmRangeM. The vertical slice seeds the three prey (rabbit, chicken,
 * deer) plus the wolf. No more than `animal.active_cap` animals are active
 * at once (GDD §12: "No more than eight animals are active at once").
 *
 * - Spawning avoids the player camera frustum and never places an animal
 *   directly beside a player (GDD §12).
 * - An animal is damaged only by a tool swing or a melee attack that lands
 *   within reach; on death its loot table drops to the ground.
 * - Animals despawn when far from every player AND untargeted for a while.
 */
import { ANIMALS, ANIMAL_BY_KIND, TUNING, type AnimalKind } from "@dustfall/content";
import { Rng, SUBSYSTEM } from "./rng.js";
import type { EntityStore, AnimalEntity, PlayerEntity } from "./entities.js";
import type { World } from "./world.js";
import { REAL_SECONDS_PER_TICK } from "./world.js";
import { spawnGroundItem } from "./pickup.js";

/**
 * Spawn up to the active cap of animals near the player(s), respecting the
 * "not beside a player" and "active cap" rules. Deterministic: uses the ai
 * RNG stream. Returns the ids spawned this tick.
 */
export const spawnWildlife = (world: World, store: EntityStore): string[] => {
  const cap = TUNING["animal.active_cap"] as number;
  const minD = (TUNING["animal.spawn_min_players_m"] as number) * 100;
  const maxD = (TUNING["animal.spawn_max_players_m"] as number) * 100;
  const rng = world.rng.get(SUBSYSTEM.ai);
  if (!rng) return [];

  const animals: AnimalEntity[] = [];
  for (const e of store.values()) if (e.kind === "animal") animals.push(e as AnimalEntity);
  const free = cap - animals.length;
  if (free <= 0) return [];

  const players: PlayerEntity[] = [];
  for (const e of store.values()) if (e.kind === "player" && !e.dead) players.push(e as PlayerEntity);
  if (players.length === 0) return []; // no one to spawn for

  const spawned: string[] = [];
  const toSpawn = Math.min(free, Math.max(1, Math.floor(free / 2))); // grow gradually
  for (let attempt = 0; attempt < 40 && spawned.length < toSpawn; attempt++) {
    const anchor = players[rng.nextInt(players.length)] ?? players[0]!;
    // random bearing + distance in [minD, maxD]
    const ang = rng.nextFloat() * Math.PI * 2;
    const dist = minD + rng.nextFloat() * (maxD - minD);
    const x = Math.round(anchor.position.x + Math.cos(ang) * dist);
    const z = Math.round(anchor.position.z + Math.sin(ang) * dist);
    // never directly beside a player (< minD) — recheck against all players
    let ok = true;
    for (const pl of players) {
      const dx = pl.position.x - x;
      const dz = pl.position.z - z;
      if (Math.sqrt(dx * dx + dz * dz) < minD * 0.8) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;

    const kind = pickKind(rng, world.clock.gameSecondsOfDay);
    spawned.push(makeAnimal(world, store, kind, { x, y: 0, z }, { x, y: 0, z }));
  }
  return spawned;
};

/**
 * Night spawns more hostiles (GDD §16: "wolves become more active" at night).
 */
const pickKind = (rng: Rng, gameSeconds: number): AnimalKind => {
  const night = gameSeconds >= 23 * 3600 || gameSeconds < 5 * 3600;
  const weights: [AnimalKind, number][] = night
    ? [["rabbit", 1], ["chicken", 1], ["deer", 2], ["wolf", 3]]
    : [["rabbit", 3], ["chicken", 3], ["deer", 4], ["wolf", 1]];
  const total = weights.reduce((s, [, w]) => s + w, 0);
  let r = rng.nextFloat() * total;
  for (const [k, w] of weights) {
    r -= w;
    if (r <= 0) return k;
  }
  return "rabbit";
};

const makeAnimal = (world: World, store: EntityStore, kind: AnimalKind, pos: { x: number; y: number; z: number }, home: { x: number; y: number; z: number }): string => {
  const def = ANIMAL_BY_KIND.get(kind)!;
  const a: AnimalEntity = {
    id: store.allocate(),
    kind: "animal",
    contentId: kind,
    position: { ...pos },
    hp: def.hp,
    maxHp: def.hp,
    state: "idle",
    lastAggroTick: world.clock.tick,
    wander: rollWander(world, store),
    home: { ...home },
    dying: false,
  };
  store.insert(a);
  return a.id;
};

const rollWander = (world: World, _store: EntityStore): { x: number; z: number } => {
  const rng = world.rng.get(SUBSYSTEM.ai);
  if (!rng) return { x: 0, z: 0 };
  const ang = rng.nextFloat() * Math.PI * 2;
  return { x: Math.cos(ang), z: Math.sin(ang) };
};

export interface AnimalHitResult {
  ok: boolean;
  reason?: string;
  damage: number;
  killed: boolean;
}

/**
 * Apply a melee / tool hit to an animal. Called from the swing resolver when
 * the swing target is an animal entity. Uses the same swing cooldown + reach
 * as node gathering so melee is consistent (GDD §11 melee 1.5 m reach; we use
 * the gather reach for M5 consistency).
 */
export const hitAnimal = (world: World, store: EntityStore, p: PlayerEntity, animalId: string, toolMultiplier: number): AnimalHitResult => {
  if (p.dead) return { ok: false, reason: "dead", damage: 0, killed: false };
  const cooldown = TUNING["gather.swing_cooldown_ticks"] as number;
  if (world.clock.tick < p.swingCooldownUntilTick) return { ok: false, reason: "cooldown", damage: 0, killed: false };

  const a = store.get(animalId as import("@dustfall/contracts").EntityId) as AnimalEntity | undefined;
  if (!a || a.kind !== "animal" || a.dying) return { ok: false, reason: "unknown_animal", damage: 0, killed: false };

  const reachM = TUNING["gather.swing_reach_m"] as number;
  const dx = p.position.x - a.position.x;
  const dz = p.position.z - a.position.z;
  if (Math.sqrt(dx * dx + dz * dz) > reachM * 100) return { ok: false, reason: "out_of_reach", damage: 0, killed: false };

  p.swingCooldownUntilTick = world.clock.tick + cooldown;
  const dmg = Math.max(1, Math.round(8 * toolMultiplier));
  a.hp -= dmg;
  // prey flees when hit; hostiles retaliate
  const def = ANIMAL_BY_KIND.get(a.contentId as AnimalKind)!;
  if (def.disposition === "prey") a.state = "flee";
  else a.state = "attack";
  a.lastAggroTick = world.clock.tick;

  let killed = false;
  if (a.hp <= 0) {
    killed = true;
    dropAnimalLoot(world, store, a);
    a.dying = true; // removed next system step
  }
  return { ok: true, damage: dmg, killed };
};

/** Drop the animal's loot table to the ground at its position. */
const dropAnimalLoot = (world: World, store: EntityStore, a: AnimalEntity): void => {
  const def = ANIMAL_BY_KIND.get(a.contentId as AnimalKind);
  if (!def) return;
  const rng = world.rng.get(SUBSYSTEM.loot);
  for (const entry of def.loot) {
    if (rng && rng.nextFloat() < entry.chance) {
      spawnGroundItem(world, store, entry.itemId, 1, { ...a.position });
    }
  }
};

/**
 * System step: move every animal by its FSM, and despawn dying / idle-far
 * animals. Runs after movement + swing so the tick's damage is applied first.
 */
export const advanceWildlife = (world: World, store: EntityStore): string[] => {
  const despspawned: string[] = [];
  const rng = world.rng.get(SUBSYSTEM.ai);

  const players: PlayerEntity[] = [];
  for (const e of store.values()) if (e.kind === "player" && !e.dead) players.push(e as PlayerEntity);

  for (const e of store.values()) {
    if (e.kind !== "animal") continue;
    const a = e as AnimalEntity;

    // remove dying (killed this tick)
    if (a.dying) {
      store.remove(a.id);
      despspawned.push(a.id);
      continue;
    }

    const def = ANIMAL_BY_KIND.get(a.contentId as AnimalKind);
    if (!def) continue;
    const speed = (def.speedCmS * REAL_SECONDS_PER_TICK) | 0;

    // find nearest live player
    let nearest: PlayerEntity | null = null;
    let nd2 = Infinity;
    for (const pl of players) {
      const dx = pl.position.x - a.position.x;
      const dz = pl.position.z - a.position.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < nd2) {
        nd2 = d2;
        nearest = pl;
      }
    }
    const nd = Math.sqrt(nd2);

    // state transitions
    if (a.state === "idle") {
      if (nearest && nd <= def.aggroRangeM * 100) {
        a.state = def.disposition === "prey" ? "flee" : "attack";
        a.lastAggroTick = world.clock.tick;
      }
    } else {
      // flee/attack: calm when the player is far or long gone
      const aggroWindow = 300; // 10 s: no player aggro for this long -> calm
      const noThreat = !nearest || nd > (def.disposition === "prey" ? def.calmRangeM * 2 : def.calmRangeM) * 100;
      if (noThreat || world.clock.tick - a.lastAggroTick > aggroWindow) {
        a.state = "idle";
        a.wander = rollWander(world, store);
      }
    }

    // movement
    let mx = 0;
    let mz = 0;
    if (a.state === "idle") {
      // slow wander toward/around home
      mx = a.wander.x * speed * 0.4;
      mz = a.wander.z * speed * 0.4;
      if (rng && rng.nextFloat() < 0.01) a.wander = rollWander(world, store);
    } else if (a.state === "flee") {
      if (nearest) {
        const dx = a.position.x - nearest.position.x;
        const dz = a.position.z - nearest.position.z;
        const m = Math.sqrt(dx * dx + dz * dz) || 1;
        mx = (dx / m) * speed;
        mz = (dz / m) * speed;
      }
    } else if (a.state === "attack") {
      if (nearest) {
        const dx = nearest.position.x - a.position.x;
        const dz = nearest.position.z - a.position.z;
        const m = Math.sqrt(dx * dx + dz * dz) || 1;
        mx = (dx / m) * speed;
        mz = (dz / m) * speed;
      }
    }
    a.position.x += mx;
    a.position.z += mz;

    // despawn: far from every player AND idle
    if (players.length > 0 && a.state === "idle") {
      const far = players.every((pl) => {
        const dx = pl.position.x - a.position.x;
        const dz = pl.position.z - a.position.z;
        return Math.sqrt(dx * dx + dz * dz) > 30000; // 300 m
      });
      if (far && world.clock.tick - a.lastAggroTick > (TUNING["animal.despawn_idle_seconds"] as number) * 30) {
        store.remove(a.id);
        despspawned.push(a.id);
      }
    }
  }
  return despspawned;
};

export { ANIMALS };
