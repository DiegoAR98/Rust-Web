/**
 * Entity id factory: "e_" + lowercase hex (GDD §24).
 */
import type { EntityId, PlayerId } from "@dustfall/contracts";

export const createEntityId = (n: number): EntityId =>
  `e_${n.toString(16).padStart(4, "0")}` as EntityId;

/**
 * PlayerId is a stable hash per GDD §22.4. For M1 test purposes the
 * server derives it from the session nonce signature.
 */
export const createPlayerId = (hex: string): PlayerId =>
  `p_${hex}` as PlayerId;
