/**
 * Player movement system (GDD §5).
 * Intent-based: each tick receives buttons + look, never an outcome.
 * Server applies gravity, ground contact, and posture speed.
 */
import { REAL_SECONDS_PER_TICK as SECONDS_PER_TICK } from "./world.js";
import { TUNING } from "@dustfall/content";
import type { PlayerEntity } from "./entities.js";

export interface MovementIntent {
  /** horizontal direction in cm/s requested by the client */
  wishX: number;
  wishZ: number;
  jump: boolean;
  crouch: boolean;
  sprint: boolean;
  /** cm/s swim flag */
  inWater: boolean;
}

export interface MovementResult {
  /** new position in cm */
  position: { x: number; y: number; z: number };
  velocityY: number;
  onGround: boolean;
  /** calories consumed this tick */
  calories: number;
}

export const applyMovement = (p: PlayerEntity, intent: MovementIntent): MovementResult => {
  const walk = TUNING["move.walk_speed"] as number;
  const sprint = TUNING["move.sprint_speed"] as number;
  const crouch = TUNING["move.crouch_speed"] as number;
  const jump = TUNING["move.jump_impulse"] as number;
  const gravity = TUNING["move.gravity"] as number;
  const swim = TUNING["move.swim_speed"] as number;

  let speed: number;
  let drain: number;
  if (intent.inWater) {
    speed = swim * 100; // cm/s
    drain = 0.5;
  } else if (p.posture === "crouching") {
    speed = crouch * 100;
    drain = 0.45;
  } else if (intent.sprint) {
    speed = sprint * 100;
    drain = 0.8;
  } else if (Math.abs(intent.wishX) > 1 || Math.abs(intent.wishZ) > 1) {
    speed = walk * 100;
    drain = 0.55;
  } else {
    speed = 0;
    drain = 0.35;
  }

  // clamp intent speed to max
  const mag = Math.sqrt(intent.wishX ** 2 + intent.wishZ ** 2);
  let dx = 0;
  let dz = 0;
  if (mag > 1) {
    const k = speed / mag;
    dx = intent.wishX * k * SECONDS_PER_TICK;
    dz = intent.wishZ * k * SECONDS_PER_TICK;
  }

  // gravity
  let vy = p.velocityY;
  vy -= gravity * 100 * SECONDS_PER_TICK; // cm/s
  if (intent.jump && p.onGround) {
    vy = jump * 100;
  }
  let y = p.position.y + vy * SECONDS_PER_TICK;
  const onGround = y <= 0;
  if (onGround) {
    y = 0;
    vy = 0;
  }

  const newPos = { x: p.position.x + dx, y, z: p.position.z + dz };
  p.position = newPos;
  p.velocityY = vy;
  p.onGround = onGround;
  p.posture = intent.crouch ? "crouching" : "standing";
  return { position: newPos, velocityY: vy, onGround: onGround, calories: drain * SECONDS_PER_TICK };
};
