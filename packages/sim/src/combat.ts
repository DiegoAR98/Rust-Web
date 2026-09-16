/**
 * M6: combat (GDD §11).
 *
 * Server-authoritative weapon resolution. The client sends intent only —
 * weapon slot, aim (yaw/pitch), target-independent sequence and client tick
 * (GDD §21.4) — never damage or hit confirmation (T09).
 *
 * - **Melee** (M6-03): sphere check, 1.5 m forward reach, first hit only
 *   (nearest target inside the forward cone).
 * - **Bow** (M6-04): physical arrow projectile with gravity; misses are
 *   recoverable (the arrow becomes a ground item).
 * - **Firearms** (M6-05): hitscan with falloff, spread, cadence, magazine
 *   and reload. No weapon penetrates walls — a shot stops at the first
 *   blocking structure.
 * - **Explosives** (M6-07): fixed fuse; character damage inside the splash
 *   radius, predictable structure splash; breach counts hold (GDD §11).
 * - **Lag compensation** (M6-06 / T10): the shooter and every target are
 *   resolved against the pose at the shooter's acknowledged client tick,
 *   clamped to the 20-tick position history. Stale/future client ticks and
 *   impossible aim deltas are rejected.
 */
import { ITEMS, TUNING, ANIMAL_BY_KIND, type ItemDef } from "@dustfall/content";
import { SUBSYSTEM } from "./rng.js";
import type { World } from "./world.js";
import { REAL_SECONDS_PER_TICK } from "./world.js";
import type { EntityStore, PlayerEntity, AnimalEntity, StructureEntity, ProjectileEntity, FuseEntity } from "./entities.js";
import { CHARACTER_CAPSULE, resolveHitZone, type HitZone, type PositionHistory } from "./hitbox.js";
import { computeDamage, type ArmorItem } from "./damage.js";
import { spawnGroundItem } from "./pickup.js";
import { destroyStructure } from "./structures.js";

// ---------------------------------------------------------------------------
// geometry helpers
// ---------------------------------------------------------------------------

const DEG = Math.PI / 180;
const STRUCTURE_BLOCK_RADIUS_CM = 200; // half of the 4 m build grid cell

/**
 * Aim direction from yaw/pitch (1/100 degree, as carried on the wire).
 * Convention: yaw 0 = facing +Z, yaw 90° = facing +X; pitch positive = up.
 * (The gate + client use this convention; the client's camera yaw is
 * negated on the wire when it reports aim.)
 */
export const aimDirection = (yawHundredths: number, pitchHundredths: number): { x: number; y: number; z: number } => {
  const yaw = (yawHundredths / 100) * DEG;
  const pitch = (pitchHundredths / 100) * DEG;
  const x = Math.sin(yaw) * Math.cos(pitch);
  const z = Math.cos(yaw) * Math.cos(pitch);
  const y = Math.sin(pitch);
  const m = Math.hypot(x, y, z) || 1;
  return { x: x / m, y: y / m, z: z / m };
};

/** The shooter's eye point: rewound feet pose + 120 cm. */
const eyeOf = (feet: { x: number; y: number; z: number }): { x: number; y: number; z: number } => ({ x: feet.x, y: feet.y + 120, z: feet.z });

/** Character chest reference height (capsule torso center). */
const chestOf = (feet: { x: number; y: number; z: number }): { x: number; y: number; z: number } => ({
  x: feet.x,
  y: feet.y + CHARACTER_CAPSULE.torsoCenterCm,
  z: feet.z,
});

/** Closest point on the ray (origin + t·dir, t ≥ 0) to a point. */
const closestPointOnRay = (
  origin: { x: number; y: number; z: number },
  dir: { x: number; y: number; z: number },
  point: { x: number; y: number; z: number },
): { dist: number; t: number; point: { x: number; y: number; z: number } } => {
  const wx = point.x - origin.x;
  const wy = point.y - origin.y;
  const wz = point.z - origin.z;
  const t = Math.max(0, wx * dir.x + wy * dir.y + wz * dir.z);
  const px = origin.x + dir.x * t;
  const py = origin.y + dir.y * t;
  const pz = origin.z + dir.z * t;
  return { dist: Math.hypot(point.x - px, point.y - py, point.z - pz), t, point: { x: px, y: py, z: pz } };
};

/**
 * Structures that block shots: the building category (walls, doors, shelter,
 * barricade, metal tier). Deployables (campfire, stations, storage) do not
 * block — vertical-slice simplification; GDD §11 "no weapon penetrates
 * walls" (walls = the build tier).
 */
export const blocksShots = (contentId: string): boolean => {
  const def = ITEMS.find((i) => i.id === contentId);
  return def?.category === "building";
};

/**
 * Resolve the pose at the given server tick (lag compensation, GDD §11).
 * Falls back to the current pose when the target has no pose at or before
 * the requested tick (e.g. it spawned later).
 */
export const poseAtTick = (history: PositionHistory, serverTick: number, current: { x: number; y: number; z: number }): { x: number; y: number; z: number } => {
  const p = history.poseAt(serverTick);
  return p ? p.position : { ...current };
};

// ---------------------------------------------------------------------------
// damage application
// ---------------------------------------------------------------------------

export interface CombatHitEvent {
  shooterId: string;
  targetPlayerId: string | undefined;
  targetAnimalId: string | undefined;
  damage: number;
  killed: boolean;
  zone: HitZone | "structure";
  weaponItemId: string;
}

const armorOf = (p: PlayerEntity): ArmorItem[] =>
  (Object.values(p.equipment) as (import("@dustfall/contracts").ItemStack | null)[])
    .filter((s): s is import("@dustfall/contracts").ItemStack => s !== null && s !== undefined)
    .map((s) => {
      const def = ITEMS.find((i) => i.id === s.itemId);
      return def?.armor ? ({ damageReduction: def.armor.damageReduction } as ArmorItem) : ({ damageReduction: 0 } as ArmorItem);
    });

/** Apply damage to a player; returns true when the victim died. */
export const hurtPlayer = (p: PlayerEntity, dmg: number): boolean => {
  p.vitals.health = Math.max(0, p.vitals.health - dmg);
  if (p.vitals.health <= 0 && !p.dead) {
    p.dead = true;
    p.deadTicks = 0;
  }
  // GDD §11: combat interrupts healing channels (M6-08)
  if (dmg > 0 && p.channel) p.channel = null;
  return p.dead;
};

/** Apply damage to an animal; returns true when it died (loot dropped). */
export const damageAnimal = (world: World, store: EntityStore, a: AnimalEntity, dmg: number): { killed: boolean } => {
  a.hp = Math.max(0, a.hp - dmg);
  const killed = a.hp <= 0;
  const def = ANIMAL_BY_KIND.get(a.contentId as import("@dustfall/content").AnimalKind);
  if (def) {
    a.state = def.disposition === "prey" ? "flee" : "attack";
    a.lastAggroTick = world.clock.tick;
  }
  if (killed) {
    dropAnimalLootAt(world, store, a);
    a.dying = true;
  }
  return { killed };
};

// ---------------------------------------------------------------------------
// fire resolution
// ---------------------------------------------------------------------------

export type FireReason =
  | "dead"
  | "not_a_weapon"
  | "no_weapon_in_hand"
  | "fire_cooldown"
  | "out_of_window"
  | "future_tick"
  | "no_ammo"
  | "empty"
  | "reloading"
  | "no_reload_needed"
  | "invalid_target";

export interface AimInfo {
  /** server tick the aim was observed on (rewind resolution point) */
  serverTick: number;
  yawHundredths: number;
  pitchHundredths: number;
}

export interface FireResult {
  ok: boolean;
  reason?: FireReason;
  weaponItemId: string | null;
  hits: CombatHitEvent[];
  /** magazine loaded after the shot (firearms) */
  loadedAfter: number;
  reloadStarted: boolean;
  projectileId?: string;
  fuseId?: string;
}

const fail = (reason: FireReason, weaponItemId: string | null): FireResult => ({ ok: false, reason, weaponItemId, hits: [], loadedAfter: 0, reloadStarted: false });

/**
 * Resolve a fire command.
 *
 * - `clientTick` is the shooter's acknowledged client tick (T19: must be
 *   ≤ now and not beyond the newest observed — the host enforces both).
 * - `aim` is the aim pose the shot resolves against, already rewound to the
 *   client tick by the caller (the per-client aim ring, T10). When null the
 *   shot is out of the rewind window.
 */
export const resolveFire = (
  world: World,
  store: EntityStore,
  p: PlayerEntity,
  clientTick: number,
  aim: AimInfo | null,
  opts: { targetEntityId?: string; reload?: boolean },
): FireResult => {
  if (p.dead) return fail("dead", null);
  const held = p.heldItemId ? p.inventory.find((s) => s !== null && s !== undefined && s.itemId === p.heldItemId) : undefined;
  if (!held) return fail("no_weapon_in_hand", null);
  const def: ItemDef | undefined = ITEMS.find((i) => i.id === held.itemId);
  const weapon = def?.weapon;
  if (!def || !weapon) return fail("not_a_weapon", null);

  // -- reload intent (firearms only) --
  if (opts.reload) {
    if (weapon.kind !== "firearm") return fail("not_a_weapon", def.id);
    const mag = weapon.magazineSize;
    const loaded = p.weapon.loadedByItemId[def.id] ?? 0;
    if (p.weapon.reloading) return fail("reloading", def.id);
    if (loaded >= mag) return fail("no_reload_needed", def.id);
    const ammoItem = weapon.ammoItemId;
    if (!ammoItem) return fail("no_ammo", def.id);
    const ammoStack = p.inventory.find((s) => s !== null && s !== undefined && s.itemId === ammoItem);
    if (!ammoStack || ammoStack.quantity <= 0) return fail("no_ammo", def.id);
    p.weapon.reloading = { weaponItemId: def.id, completesAtTick: world.clock.tick + (weapon.reloadTicks ?? 0), resumeAtLoaded: loaded };
    return { ok: true, weaponItemId: def.id, hits: [], loadedAfter: p.weapon.reloading.resumeAtLoaded, reloadStarted: true };
  }

  // -- cadence (impossible fire rates are rejected, GDD §11) --
  if (world.clock.tick < p.fireCooldownUntilTick) return fail("fire_cooldown", def.id);

  // -- rewind window (T10 / T19) --
  if (clientTick > world.clock.tick) return fail("future_tick", def.id);
  if (!aim) return fail("out_of_window", def.id);
  const shooterPose = p.poseHistory.poseAt(aim.serverTick);
  if (!shooterPose) return fail("out_of_window", def.id);

  const dir0 = aimDirection(aim.yawHundredths, aim.pitchHundredths);
  const spread = (weapon.spreadDegrees ?? 0) * DEG;
  const rng = world.rng.get(SUBSYSTEM.world)!;
  const dir = spread > 0 ? applySpread(dir0, rng, spread) : dir0;
  const origin = shooterPose.position;

  let result: FireResult;
  switch (weapon.kind) {
    case "melee":
      result = resolveMelee(world, store, p, def, origin, dir);
      break;
    case "bow":
      result = resolveBow(world, store, p, def, aim.serverTick, origin, dir);
      break;
    case "firearm":
      result = resolveFirearm(world, store, p, def, aim.serverTick, origin, dir);
      break;
    case "explosive":
      result = resolveExplosive(world, store, p, def, origin, dir, opts.targetEntityId);
      break;
  }
  if (result.ok) p.fireCooldownUntilTick = world.clock.tick + weapon.fireIntervalTicks;
  return result;
};

/** Uniform in-cone spread roll on the world RNG. */
const applySpread = (dir: { x: number; y: number; z: number }, rng: import("./rng.js").Rng, spreadRad: number): { x: number; y: number; z: number } => {
  const ang = (rng.nextFloat() * 2 - 1) * spreadRad;
  const cos = Math.cos(ang);
  const sin = Math.sin(ang);
  return { x: dir.x * cos - dir.z * sin, y: dir.y, z: dir.x * sin + dir.z * cos };
};

const vlenOf = (v: { x: number; y: number; z: number }): number => Math.hypot(v.x, v.y, v.z) || 1;

// ---- melee (M6-03) ---------------------------------------------------------

const resolveMelee = (
  world: World,
  store: EntityStore,
  p: PlayerEntity,
  def: ItemDef,
  origin: { x: number; y: number; z: number },
  dir: { x: number; y: number; z: number },
): FireResult => {
  const weapon = def.weapon!;
  const reachCm = Number(TUNING["combat.melee_reach_m"] ?? 1.5) * 100;
  const arc = Number(TUNING["combat.melee_arc_degrees"] ?? 90) * DEG;
  const arcCos = Math.cos(arc / 2);

  let best: { target: PlayerEntity | AnimalEntity; dist: number; hitPoint: { x: number; y: number; z: number }; feet: { x: number; y: number; z: number } } | null = null;
  for (const e of store.values()) {
    if (e.kind !== "player" && e.kind !== "animal") continue;
    if (e.kind === "player") {
      const t = e as PlayerEntity;
      if (t.dead || t.playerId === p.playerId) continue;
      const center = chestOf(t.position);
      const dx = center.x - origin.x;
      const dy = center.y - origin.y;
      const dz = center.z - origin.z;
      const dist = Math.hypot(dx, dy, dz);
      if (dist > reachCm) continue;
      const dot = (dx * dir.x + dy * dir.y + dz * dir.z) / (dist || 1);
      if (dot < arcCos) continue;
      if (!best || dist < best.dist) best = { target: t, dist, hitPoint: center, feet: { ...t.position } };
    } else {
      const t = e as AnimalEntity;
      if (t.dying) continue;
      const center = chestOf(t.position);
      const dx = center.x - origin.x;
      const dy = center.y - origin.y;
      const dz = center.z - origin.z;
      const dist = Math.hypot(dx, dy, dz);
      if (dist > reachCm) continue;
      const dot = (dx * dir.x + dy * dir.y + dz * dir.z) / (dist || 1);
      if (dot < arcCos) continue;
      if (!best || dist < best.dist) best = { target: t, dist, hitPoint: center, feet: { ...t.position } };
    }
  }

  if (!best) return { ok: true, weaponItemId: def.id, hits: [], loadedAfter: 0, reloadStarted: false };

  const isPlayer = best.target.kind === "player";
  const zone: HitZone = resolveHitZone(CHARACTER_CAPSULE, best.feet, best.hitPoint) ?? "torso";
  const armor = isPlayer ? armorOf(best.target as PlayerEntity) : [];
  const dmg = computeDamage({ baseDamage: weapon.baseDamage, distanceM: 0, falloffStartM: 0, falloffEndM: 0, zone, wornArmor: armor });
  const killed = isPlayer ? hurtPlayer(best.target as PlayerEntity, dmg) : damageAnimal(world, store, best.target as AnimalEntity, dmg).killed;
  return {
    ok: true,
    weaponItemId: def.id,
    loadedAfter: 0,
    reloadStarted: false,
    hits: [
      {
        shooterId: p.playerId,
        targetPlayerId: isPlayer ? (best.target as PlayerEntity).playerId : undefined,
        targetAnimalId: isPlayer ? undefined : (best.target as AnimalEntity).id,
        damage: dmg,
        killed,
        zone,
        weaponItemId: def.id,
      },
    ],
  };
};

// ---- bow (M6-04) -----------------------------------------------------------

const resolveBow = (
  world: World,
  store: EntityStore,
  p: PlayerEntity,
  def: ItemDef,
  serverTick: number,
  origin: { x: number; y: number; z: number },
  dir: { x: number; y: number; z: number },
): FireResult => {
  const weapon = def.weapon!;
  const ammoItem = weapon.ammoItemId;
  if (!ammoItem) return fail("no_ammo", def.id);
  const stackIdx = p.inventory.findIndex((s) => s !== null && s !== undefined && s.itemId === ammoItem);
  if (stackIdx < 0) return fail("no_ammo", def.id);
  const stack = p.inventory[stackIdx]!;
  stack.quantity -= 1;
  if (stack.quantity <= 0) p.inventory[stackIdx] = null;

  const speed = weapon.projectileSpeedCmS ?? 600;
  const eye = eyeOf(origin);
  const pr: ProjectileEntity = {
    id: store.allocate(),
    kind: "projectile",
    contentId: ammoItem,
    weaponItemId: def.id,
    ownerId: p.playerId,
    position: { ...eye },
    velocity: { x: dir.x * speed, y: dir.y * speed, z: dir.z * speed },
    bornAtTick: world.clock.tick,
    expireAtTick: world.clock.tick + Number(TUNING["combat.bow_arrow_life_ticks"] ?? 600),
    rewindServerTick: serverTick,
  };
  store.insert(pr);
  return { ok: true, weaponItemId: def.id, hits: [], loadedAfter: 0, reloadStarted: false, projectileId: pr.id };
};

// ---- firearms (M6-05) -------------------------------------------------------

const resolveFirearm = (
  world: World,
  store: EntityStore,
  p: PlayerEntity,
  def: ItemDef,
  serverTick: number,
  origin: { x: number; y: number; z: number },
  dir: { x: number; y: number; z: number },
): FireResult => {
  const weapon = def.weapon!;
  const loaded = p.weapon.loadedByItemId[def.id] ?? 0;
  if (p.weapon.reloading) return fail("reloading", def.id);
  if (loaded <= 0) return fail("empty", def.id);
  p.weapon.loadedByItemId[def.id] = loaded - 1;
  const after = loaded - 1;

  const eye = eyeOf(origin);
  const rangeCm = (weapon.falloffEndM > 0 ? weapon.falloffEndM : 50) * 100;
  const pellets = weapon.pellets ?? 1;
  const rng = world.rng.get(SUBSYSTEM.world)!;

  const hits: CombatHitEvent[] = [];
  for (let pel = 0; pel < pellets; pel++) {
    const d = pellets > 1 ? applySpread(dir, rng, (weapon.spreadDegrees ?? 2) * DEG) : dir;
    const hit = hitscan(world, store, p, def, eye, d, rangeCm, serverTick);
    if (hit) hits.push(hit);
  }
  return { ok: true, weaponItemId: def.id, hits, loadedAfter: after, reloadStarted: false };
};

/**
 * Hitscan: the nearest blocking structure or character along the ray wins.
 * No weapon penetrates walls (GDD §11) — a blocked shot deals no damage.
 */
const hitscan = (
  world: World,
  store: EntityStore,
  shooter: PlayerEntity,
  def: ItemDef,
  eye: { x: number; y: number; z: number },
  dir: { x: number; y: number; z: number },
  rangeCm: number,
  serverTick: number,
): CombatHitEvent | null => {
  const weapon = def.weapon!;
  let bestT = Infinity;
  let bestPlayer: PlayerEntity | null = null;
  let bestAnimal: AnimalEntity | null = null;
  let hitPoint: { x: number; y: number; z: number } | null = null;
  let targetFeet: { x: number; y: number; z: number } | null = null;
  let blockedByStructure = false;

  for (const e of store.values()) {
    if (e.kind === "player" || e.kind === "animal") {
      const t = e.kind === "player" ? (e as PlayerEntity) : (e as AnimalEntity);
      const isDead = t.kind === "player" ? t.dead : t.dying;
      if (isDead) continue;
      if (t.kind === "player" && t.playerId === shooter.playerId) continue; // no self-hit
      const feet = poseAtTick(t.poseHistory, serverTick, t.position);
      const chest = chestOf(feet);
      const c = closestPointOnRay(eye, dir, chest);
      const radius = (CHARACTER_CAPSULE.torsoRadiusCm + 10) * 1.05;
      if (c.dist <= radius && c.t < bestT && c.t <= rangeCm) {
        bestT = c.t;
        bestPlayer = e.kind === "player" ? (e as PlayerEntity) : null;
        bestAnimal = e.kind === "animal" ? (e as AnimalEntity) : null;
        hitPoint = c.point;
        targetFeet = feet;
        blockedByStructure = false;
      }
    } else if (e.kind === "structure") {
      const st = e as StructureEntity;
      if (!blocksShots(st.contentId)) continue;
      const c = closestPointOnRay(eye, dir, st.position);
      if (c.dist <= STRUCTURE_BLOCK_RADIUS_CM && c.t < bestT && c.t <= rangeCm) {
        bestT = c.t;
        bestPlayer = null;
        bestAnimal = null;
        blockedByStructure = true;
      }
    }
  }

  if (!bestPlayer && !bestAnimal) return null; // nothing or a structure stopped it
  if (blockedByStructure) return null;

  const zone: HitZone = targetFeet && hitPoint ? (resolveHitZone(CHARACTER_CAPSULE, targetFeet, hitPoint) ?? "torso") : "torso";
  const distM = bestT / 100;
  const armor = bestPlayer ? armorOf(bestPlayer) : [];
  const dmg = computeDamage({
    baseDamage: weapon.baseDamage,
    distanceM: distM,
    falloffStartM: weapon.falloffStartM,
    falloffEndM: weapon.falloffEndM,
    zone,
    wornArmor: armor,
  });
  const killed = bestPlayer ? hurtPlayer(bestPlayer, dmg) : damageAnimal(world, store, bestAnimal!, dmg).killed;
  return {
    shooterId: shooter.playerId,
    targetPlayerId: bestPlayer ? bestPlayer.playerId : undefined,
    targetAnimalId: bestAnimal ? bestAnimal.id : undefined,
    damage: dmg,
    killed,
    zone,
    weaponItemId: def.id,
  };
};

// ---- explosives (M6-07) -----------------------------------------------------

const resolveExplosive = (
  world: World,
  store: EntityStore,
  p: PlayerEntity,
  def: ItemDef,
  origin: { x: number; y: number; z: number },
  dir: { x: number; y: number; z: number },
  targetEntityId: string | undefined,
): FireResult => {
  const weapon = def.weapon!;
  const idx = p.inventory.findIndex((s) => s !== null && s !== undefined && s.itemId === def.id);
  if (idx < 0) return fail("no_ammo", def.id);
  const stack = p.inventory[idx]!;
  stack.quantity -= 1;
  if (stack.quantity <= 0) p.inventory[idx] = null;

  let pos: { x: number; y: number; z: number };
  let targetStructure: StructureEntity | null = null;
  if (targetEntityId) {
    const t = store.get(targetEntityId as import("@dustfall/contracts").EntityId);
    if (!t || t.kind !== "structure" || t.hp <= 0) return fail("invalid_target", def.id);
    targetStructure = t as StructureEntity;
    pos = { ...t.position };
  } else {
    // throw along the aim a fixed 10 m; clamps at terrain
    const eye = eyeOf(origin);
    const t = 1000;
    pos = { x: eye.x + dir.x * t, y: Math.max(0, eye.y + dir.y * t), z: eye.z + dir.z * t };
  }

  const fuse: FuseEntity = {
    id: store.allocate(),
    kind: "fuse",
    contentId: def.id,
    ownerId: p.playerId,
    position: pos,
    targetStructureId: targetStructure ? targetStructure.id : null,
    detonateAtTick: world.clock.tick + (weapon.fuseTicks ?? 120),
  };
  store.insert(fuse);
  return { ok: true, weaponItemId: def.id, hits: [], loadedAfter: 0, reloadStarted: false, fuseId: fuse.id };
};

// ---------------------------------------------------------------------------
// per-tick advances
// ---------------------------------------------------------------------------

/**
 * Advance magazine reloads; on completion the weapon's magazine is refilled
 * from the inventory ammo stack (partial mag when the stack is short — no
 * ammo is lost).
 */
export const advanceWeapons = (world: World, store: EntityStore): { playerId: string; weaponItemId: string; loadedAfter: number }[] => {
  const done: { playerId: string; weaponItemId: string; loadedAfter: number }[] = [];
  for (const e of store.values()) {
    if (e.kind !== "player") continue;
    const p = e as PlayerEntity;
    const r = p.weapon.reloading;
    if (!r || world.clock.tick < r.completesAtTick) continue;
    const def = ITEMS.find((i) => i.id === r.weaponItemId);
    const weapon = def?.weapon;
    p.weapon.reloading = null;
    if (!weapon) continue;
    const ammoItem = weapon.ammoItemId;
    let loaded = r.resumeAtLoaded;
    if (ammoItem) {
      const need = weapon.magazineSize - loaded;
      const stackIdx = p.inventory.findIndex((s) => s !== null && s !== undefined && s.itemId === ammoItem);
      if (stackIdx >= 0) {
        const stack = p.inventory[stackIdx]!;
        const take = Math.min(need, stack.quantity);
        stack.quantity -= take;
        loaded += take;
        if (stack.quantity <= 0) p.inventory[stackIdx] = null;
      }
    }
    p.weapon.loadedByItemId[r.weaponItemId] = loaded;
    done.push({ playerId: p.playerId, weaponItemId: r.weaponItemId, loadedAfter: loaded });
  }
  return done;
};

export interface ProjectileAdvanceResult {
  /** ids removed this tick (hit, expired, blocked, landed) */
  expired: string[];
  /** authoritative hits applied this tick */
  hits: CombatHitEvent[];
}

/**
 * Advance live projectiles (bow arrows): integrate with gravity, sweep-hit
 * characters at the shooter's acknowledged tick (T10), stop on blocking
 * structures, and recover misses (the arrow becomes a ground item).
 */
export const advanceProjectiles = (world: World, store: EntityStore): ProjectileAdvanceResult => {
  const expired: string[] = [];
  const hits: CombatHitEvent[] = [];
  const dt = REAL_SECONDS_PER_TICK;
  const gravity = Number(TUNING["move.gravity"] ?? 19.6) * 100; // cm/s²

  for (const e of store.values()) {
    if (e.kind !== "projectile") continue;
    const pr = e as ProjectileEntity;

    if (world.clock.tick >= pr.expireAtTick) {
      recoverArrow(world, store, pr);
      store.remove(pr.id);
      expired.push(pr.id);
      continue;
    }

    const removed = advanceOneProjectile(world, store, pr, gravity, dt, hits);
    if (removed) {
      store.remove(pr.id);
      expired.push(pr.id);
    }
  }
  return { expired, hits };
};

/** Integrate one tick; returns true when the projectile should be removed. */
const advanceOneProjectile = (
  world: World,
  store: EntityStore,
  pr: ProjectileEntity,
  gravity: number,
  dt: number,
  hits: CombatHitEvent[],
): boolean => {
  const steps = 3; // swept sub-steps: a fast arrow can't tunnel a capsule
  for (let s = 0; s < steps; s++) {
    const segStart = { x: pr.position.x, y: pr.position.y, z: pr.position.z };
    pr.position.x += (pr.velocity.x * dt) / steps;
    pr.position.y += (pr.velocity.y * dt) / steps;
    pr.position.z += (pr.velocity.z * dt) / steps;
    pr.velocity.y -= gravity * dt;

    // terminal: the arrow reaches the ground — recoverable (GDD §11)
    if (pr.position.y <= 0) {
      pr.position.y = 0;
      recoverArrow(world, store, pr);
      return true;
    }
    // a blocking structure stops the arrow (no weapon penetrates walls)
    if (structureBlocking(store, segStart, pr, (dt / steps) * vlenOf(pr.velocity))) {
      recoverArrow(world, store, pr);
      return true;
    }
    // swept hit test against characters at the rewound pose (T10)
    const hit = projectileHit(world, store, pr, segStart, (dt / steps) * vlenOf(pr.velocity));
    if (hit) {
      hits.push(hit);
      recoverArrow(world, store, pr);
      return true;
    }
  }
  return false;
};

/** Find the first character whose capsule the arrow segment passed through. */
const projectileHit = (
  world: World,
  store: EntityStore,
  pr: ProjectileEntity,
  segStart: { x: number; y: number; z: number },
  segLen: number,
): CombatHitEvent | null => {
  let best: { target: PlayerEntity | AnimalEntity; point: { x: number; y: number; z: number }; feet: { x: number; y: number; z: number }; t: number } | null = null;
  const vlen = Math.hypot(pr.velocity.x, pr.velocity.y, pr.velocity.z) || 1;
  const dir = { x: pr.velocity.x / vlen, y: pr.velocity.y / vlen, z: pr.velocity.z / vlen };
  for (const e of store.values()) {
    if (e.kind !== "player" && e.kind !== "animal") continue;
    const t = e.kind === "player" ? (e as PlayerEntity) : (e as AnimalEntity);
    const isDead = t.kind === "player" ? t.dead : t.dying;
    if (isDead) continue;
    if (t.kind === "player" && t.playerId === pr.ownerId) continue; // no self-hit
    const feet = poseAtTick(t.poseHistory, pr.rewindServerTick, t.position);
    const chest = chestOf(feet);
    const c = closestPointOnRay(segStart, dir, chest);
    if (c.dist <= CHARACTER_CAPSULE.torsoRadiusCm * 1.1 && c.t <= segLen && (best === null || c.t < best.t)) {
      best = { target: t, point: c.point, feet, t: c.t };
    }
  }
  if (!best) return null;

  const bow = ITEMS.find((i) => i.id === pr.weaponItemId);
  const weapon = bow?.weapon;
  const distM = Math.hypot(best.point.x - segStart.x, best.point.y - segStart.y, best.point.z - segStart.z) / 100;
  const zone: HitZone = resolveHitZone(CHARACTER_CAPSULE, best.feet, best.point) ?? "torso";
  const isPlayer = best.target.kind === "player";
  const armor = isPlayer ? armorOf(best.target as PlayerEntity) : [];
  const dmg = computeDamage({
    baseDamage: weapon?.baseDamage ?? 12,
    distanceM: distM,
    falloffStartM: weapon?.falloffStartM ?? 0,
    falloffEndM: weapon?.falloffEndM ?? 0,
    zone,
    wornArmor: armor,
  });
  const killed = isPlayer ? hurtPlayer(best.target as PlayerEntity, dmg) : damageAnimal(world, store, best.target as AnimalEntity, dmg).killed;
  return {
    shooterId: pr.ownerId,
    targetPlayerId: isPlayer ? (best.target as PlayerEntity).playerId : undefined,
    targetAnimalId: isPlayer ? undefined : (best.target as AnimalEntity).id,
    damage: dmg,
    killed,
    zone,
    weaponItemId: pr.weaponItemId,
  };
};

/** A blocking structure on the arrow's segment (no weapon penetrates walls). */
const structureBlocking = (store: EntityStore, segStart: { x: number; y: number; z: number }, pr: ProjectileEntity, segLen: number): boolean => {
  const vlen = Math.hypot(pr.velocity.x, pr.velocity.y, pr.velocity.z) || 1;
  const dir = { x: pr.velocity.x / vlen, y: pr.velocity.y / vlen, z: pr.velocity.z / vlen };
  for (const e of store.values()) {
    if (e.kind !== "structure") continue;
    const st = e as StructureEntity;
    if (!blocksShots(st.contentId)) continue;
    const c = closestPointOnRay(segStart, dir, st.position);
    if (c.dist <= STRUCTURE_BLOCK_RADIUS_CM && c.t > 0 && c.t <= segLen) return true;
  }
  return false;
};

/** Recoverable miss: the arrow drops to the ground where it landed. */
const recoverArrow = (world: World, store: EntityStore, pr: ProjectileEntity): void => {
  spawnGroundItem(world, store, pr.contentId as import("@dustfall/contracts").ItemId, 1, { ...pr.position });
};

// ---------------------------------------------------------------------------
// detonation (M6-07)
// ---------------------------------------------------------------------------

export interface DetonationEvent {
  fuseId: string;
  ownerId: string;
  weaponItemId: string;
  hits: CombatHitEvent[];
  structures: { structureEntityId: string; damage: number; hpAfter: number; destroyed: boolean }[];
  position: { x: number; y: number; z: number };
}

/**
 * Detonate every fuse whose timer elapsed this tick. The planted target
 * structure takes the full flat damage; every other structure inside the
 * splash radius takes the flat structure damage; every character inside the
 * splash radius takes the flat character damage (owner included).
 * Breach counts (GDD §11) hold because the flat values are authored in
 * content: 6 grenades × 85 breach a Wood Door (500); 1 charge (600) breaches
 * a Wood Door; 2 charges breach a Metal Door (1000) or Wood Wall (800…
 * vertical slice uses 800); 4 charges breach a Metal Wall (2000).
 */
export const detonateFuses = (world: World, store: EntityStore): DetonationEvent[] => {
  const events: DetonationEvent[] = [];
  for (const e of store.values()) {
    if (e.kind !== "fuse") continue;
    const f = e as FuseEntity;
    if (world.clock.tick < f.detonateAtTick) continue;
    const def = ITEMS.find((i) => i.id === f.contentId);
    const weapon = def?.weapon;
    const structureDamage = weapon?.structureDamage ?? 85;
    const characterDamage = weapon?.characterDamage ?? 50;
    const radiusCm = (weapon?.splashRadiusM ?? 3) * 100;

    const ev: DetonationEvent = { fuseId: f.id, ownerId: f.ownerId, weaponItemId: f.contentId, hits: [], structures: [], position: { ...f.position } };

    const structures: StructureEntity[] = [];
    for (const s of store.values()) if (s.kind === "structure") structures.push(s as StructureEntity);
    for (const st of structures) {
      const dx = st.position.x - f.position.x;
      const dy = st.position.y - f.position.y;
      const dz = st.position.z - f.position.z;
      const d = Math.hypot(dx, dy, dz);
      let dmg = 0;
      if (st.id === f.targetStructureId) dmg = structureDamage;
      else if (d <= radiusCm) dmg = structureDamage;
      if (dmg <= 0) continue;
      st.hp = Math.max(0, st.hp - dmg);
      const destroyed = st.hp <= 0;
      ev.structures.push({ structureEntityId: st.id, damage: dmg, hpAfter: st.hp, destroyed });
      if (destroyed) destroyStructure(world, store, st);
    }

    for (const s of store.values()) {
      if (s.kind !== "player" && s.kind !== "animal") continue;
      const t = s.kind === "player" ? (s as PlayerEntity) : (s as AnimalEntity);
      const isDead = t.kind === "player" ? t.dead : t.dying;
      if (isDead) continue;
      const dx = t.position.x - f.position.x;
        const dy = t.position.y - f.position.y;
        const dz = t.position.z - f.position.z;
        if (Math.hypot(dx, dy, dz) > radiusCm) continue;
        if (s.kind === "player") {
          const killed = hurtPlayer(t as PlayerEntity, characterDamage);
          ev.hits.push({ shooterId: f.ownerId, targetPlayerId: (t as PlayerEntity).playerId, targetAnimalId: undefined, damage: characterDamage, killed, zone: "torso", weaponItemId: f.contentId });
        } else {
          const killed = damageAnimal(world, store, t as AnimalEntity, characterDamage).killed;
          ev.hits.push({ shooterId: f.ownerId, targetPlayerId: undefined, targetAnimalId: (t as AnimalEntity).id, damage: characterDamage, killed, zone: "torso", weaponItemId: f.contentId });
        }
    }

    store.remove(f.id);
    events.push(ev);
  }
  return events;
};

// ---------------------------------------------------------------------------
// shared loot drop
// ---------------------------------------------------------------------------

const dropAnimalLootAt = (world: World, store: EntityStore, a: AnimalEntity): void => {
  const def = ANIMAL_BY_KIND.get(a.contentId as import("@dustfall/content").AnimalKind);
  if (!def) return;
  const rng = world.rng.get(SUBSYSTEM.loot);
  for (const entry of def.loot) {
    if (rng && rng.nextFloat() < entry.chance) spawnGroundItem(world, store, entry.itemId, 1, { ...a.position });
  }
};
