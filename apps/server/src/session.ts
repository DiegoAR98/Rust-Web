/**
 * Connection session state machine (GDD §22.4):
 * connect -> hello -> baseline -> ready.
 * Gameplay input before Ready is rejected.
 */
export type SessionState = "connecting" | "awaiting_baseline" | "ready";

export interface Session {
  id: string;
  playerId: string;
  state: SessionState;
  /** highest client envelope sequence received */
  ackInputSequence: number;
  /** client input sequences queued for the next tick */
  pending: import("@dustfall/protocol").ClientEnvelopeProto[];
  joinedAtTick: number;
  /** bytes currently queued in the socket */
  queuedBytes: number;
  backpressureSince: number | null;
}

export class SessionRegistry {
  private readonly byId = new Map<string, Session>();

  add(s: Session): void {
    this.byId.set(s.id, s);
  }

  get(id: string): Session | undefined {
    return this.byId.get(id);
  }

  remove(id: string): void {
    this.byId.delete(id);
  }

  *all(): IterableIterator<Session> {
    yield* this.byId.values();
  }

  size(): number {
    return this.byId.size;
  }
}
