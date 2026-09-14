/**
 * Physics port implementation.
 * M0: stub (no-op) so the monorepo compiles and sim can be tested without
 * Rapier. The real implementation loads @dimforge/rapier3d-deterministic
 * WASM and is validated in M-1B.
 */
import type { PhysicsPort, MoveCharacterInput, MoveCharacterResult, RayHit, StaticShape, EntityId } from "@dustfall/contracts";

export class StubPhysics implements PhysicsPort {
  step(_dt: number): void {}

  moveCharacter(input: MoveCharacterInput): MoveCharacterResult {
    // Stub: apply intent directly, ground at y=0
    const dt = input.dt;
    const vy = input.vy;
    let y = 0; // ground level
    return {
      position: { x: input.velocity.x * dt, y: y, z: input.velocity.z * dt },
      onGround: true,
      resolvedVelocity: { x: input.velocity.x, y: vy, z: input.velocity.z },
    };
  }

  raycast(_from: { x: number; y: number; z: number }, _dir: { x: number; y: number; z: number }, _maxDist: number): RayHit | null {
    return null;
  }

  overlap(_center: { x: number; y: number; z: number }, _radius: number): readonly EntityId[] {
    return [];
  }

  addStaticCollider(_entityId: EntityId, _shape: StaticShape): void {}

  removeCollider(_entityId: EntityId): void {}
}

export const createPhysics = (): PhysicsPort => new StubPhysics();
