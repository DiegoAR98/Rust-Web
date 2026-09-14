/**
 * PhysicsPort per GDD §21.6.
 * `sim` calls this interface; `packages/physics` implements it with the
 * deterministic Rapier WASM build. Rapier handles never escape that package.
 */
import type { EntityId } from "./ids.js";

export interface MoveCharacterInput {
  entityId: EntityId;
  /** desired horizontal movement in cm/s */
  velocity: { x: number; z: number };
  /** vertical impulse or velocity contribution in cm/s */
  vy: number;
  /** crouching changes the collider height */
  crouching: boolean;
  /** dt in seconds (the fixed 1/30) */
  dt: number;
}

export interface MoveCharacterResult {
  position: { x: number; y: number; z: number };
  onGround: boolean;
  /** cm per axis actually applied */
  resolvedVelocity: { x: number; y: number; z: number };
}

export interface RayHit {
  entityId: EntityId;
  point: { x: number; y: number; z: number };
  distance: number;
  normal: { x: number; y: number; z: number };
}

export interface PhysicsPort {
  /** Advance one world step. */
  step(dt: number): void;
  /** Character shape cast; returns authoritative position. */
  moveCharacter(input: MoveCharacterInput): MoveCharacterResult;
  /** Ray against static + dynamic colliders. */
  raycast(from: { x: number; y: number; z: number }, dir: { x: number; y: number; z: number }, maxDist: number): RayHit | null;
  /** Overlap query returning entity ids. */
  overlap(center: { x: number; y: number; z: number }, radius: number): readonly EntityId[];
  /** Add a static collider owned by an entity. */
  addStaticCollider(entityId: EntityId, shape: StaticShape): void;
  /** Remove all colliders owned by an entity. */
  removeCollider(entityId: EntityId): void;
}

export type StaticShape =
  | { kind: "box"; halfExtents: { x: number; y: number; z: number }; position: { x: number; y: number; z: number } }
  | { kind: "cylinder"; radius: number; height: number; position: { x: number; y: number; z: number } };
