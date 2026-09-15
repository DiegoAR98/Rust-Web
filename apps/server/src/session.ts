/**
 * Connection session state machine (GDD §22.4):
 * connect -> hello -> challenge -> identity -> baseline -> ready.
 *
 * M2: the identity proof (ECDSA P-256 signature over the challenge nonce)
 * must be verified before the session may enter awaiting_baseline;
 * gameplay input before Ready is rejected.
 */
export type SessionState =
  | "connecting"
  | "awaiting_challenge"
  | "awaiting_identity"
  | "awaiting_baseline"
  | "ready";

export interface Session {
  id: string;
  playerId: string;
  state: SessionState;
  /** public key (stored verbatim per GDD 22.4) */
  jwk?: import("@dustfall/protocol").JwkProto;
  /** server challenge nonce (base64url) */
  nonce?: string;
  /** highest client envelope sequence received */
  ackInputSequence: number;
  /** client input sequences queued for the next tick */
  pending: import("@dustfall/protocol").ClientEnvelopeProto[];
  joinedAtTick: number;
  /** bytes currently queued in the socket */
  queuedBytes: number;
  backpressureSince: number | null;
  /** when the socket was opened (handshake timeout, GDD 22.6) */
  connectedAtMs: number;
  /** when the session became ready (reconnect window, GDD 22.4/22.6) */
  readyAtMs?: number;
  /** when the last socket closed; set by the gateway for reconnect */
  lastDisconnectAtMs?: number;
  /** entity ids already sent to this session (baseline + batches) */
  seen: Set<string>;
  /** the baseline id this session received (acked in the baseline ack) */
  baselineId: number;
}

export class SessionRegistry {
  private readonly byId = new Map<string, Session>();
  /** playerId -> live session (identity is unique per world, GDD 22.5) */
  private readonly byPlayerId = new Map<string, string>();

  add(s: Session): void {
    this.byId.set(s.id, s);
    this.byPlayerId.set(s.playerId, s.id);
  }

  get(id: string): Session | undefined {
    return this.byId.get(id);
  }

  /** The live session for a player, if any (M2: one identity per world). */
  sessionForPlayer(playerId: string): Session | undefined {
    const id = this.byPlayerId.get(playerId);
    return id ? this.byId.get(id) : undefined;
  }

  remove(id: string): void {
    const s = this.byId.get(id);
    if (s) this.byPlayerId.delete(s.playerId);
    this.byId.delete(id);
  }

  *all(): IterableIterator<Session> {
    yield* this.byId.values();
  }

  size(): number {
    return this.byId.size;
  }
}
