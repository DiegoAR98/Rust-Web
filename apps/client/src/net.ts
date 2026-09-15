/**
 * WebSocket gateway: M2 handshake (challenge -> identity -> grant -> baseline
 * -> ready) then msgpack gameplay envelopes/snapshots (GDD §22.4, §21.7).
 */
import { encode, decode } from "@msgpack/msgpack";
import type {
  ClientEnvelopeProto,
  ClientCommandProto,
  SnapshotProto,
} from "@dustfall/protocol";
import { ensureIdentity, signChallenge, type PublicJwk } from "./identity.js";

/** Server handshake challenge (JSON, first text frame). */
interface ChallengeMsg {
  protocol: number;
  kind: "challenge";
  sessionId: string;
  nonce: string;
  serverTick: number;
  worldId: string;
}

/** Server session grant (JSON, after identity verification). */
export interface GrantMsg {
  protocol: number;
  kind: "session_grant";
  sessionId: string;
  playerId: string;
  expiresAt: number;
  token: string;
  hasSavedPlayer: boolean;
}

export class GameSocket {
  private ws: WebSocket;
  private sequence = 0;
  private clientTick = 0;
  private sessionId = "";
  private pendingChallenge: string | null = null;
  private baselineAcked = false;
  private signingKey: CryptoKey | null = null;
  private grant: GrantMsg | null = null;
  private resolvingGrant: ((g: GrantMsg) => void) | null = null;
  private rejectingGrant: ((e: Error) => void) | null = null;

  public publicJwk: PublicJwk | null = null;
  public state: "connecting" | "authenticating" | "connected" | "closed" = "connecting";
  onSnapshot: ((s: SnapshotProto) => void) | null = null;
  onReady: (() => void) | null = null;
  onKicked: ((reason: string) => void) | null = null;

  constructor(url: string) {
    this.ws = new WebSocket(url);
    // Binary gameplay frames are msgpack over an ArrayBuffer (GDD §21.7).
    // The browser default is "blob", which decode() cannot read.
    this.ws.binaryType = "arraybuffer";
  }

  get connected(): boolean {
    return this.ws.readyState === WebSocket.OPEN;
  }

  get ready(): boolean {
    return this.ws.readyState === WebSocket.OPEN && this.grant !== null;
  }

  get playerIdentity(): { sessionId: string; playerId: string } | null {
    return this.grant ? { sessionId: this.grant.sessionId, playerId: this.grant.playerId } : null;
  }

  /**
   * Drive the handshake: load/generate the P-256 identity, wait for the
   * challenge, sign it, send the proof and resolve once the server grants.
   * Rejects if the server disconnects or kicks before the grant.
   */
  connect(): Promise<GrantMsg> {
    this.ws.onopen = () => {
      this.state = "authenticating";
    };
    this.ws.onmessage = this.onMessage;
    this.ws.onerror = (ev) => console.error("socket error", ev);
    this.ws.onclose = (ev) => {
      const reason = `socket closed (code ${ev.code})`;
      if (this.rejectingGrant) {
        const reject = this.rejectingGrant;
        this.rejectingGrant = null;
        reject(new Error(reason));
      }
      this.state = "closed";
      if (this.ws.readyState !== WebSocket.OPEN) {
        this.state = "closed";
      }
    };

    return new Promise<GrantMsg>((resolve, reject) => {
      this.resolvingGrant = resolve;
      this.rejectingGrant = reject;
      ensureIdentity().then(([pub, key]) => {
        this.publicJwk = pub;
        this.signingKey = key;
        // If the challenge arrived before identity was ready, answer now.
        if (this.pendingChallenge) {
          this.answerChallenge(this.pendingChallenge);
        }
      }).catch((err) => {
        reject(err instanceof Error ? err : new Error("identity unavailable"));
      });
    });
  }

  private answerChallenge(nonce: string): void {
    if (!this.signingKey || !this.publicJwk) return;
    const sessionId = this.sessionId;
    void signChallenge(nonce, this.signingKey).then((signature) => {
      const proof = {
        protocol: 1,
        kind: "identity",
        sessionId,
        publicKey: this.publicJwk as { kty: string; crv: string; x: string; y: string; alg?: string },
        signature,
      };
      this.ws.send(encode(proof));
    });
  }

  private onMessage = (ev: MessageEvent): void => {
    if (ev.type === "message" && typeof ev.data === "string") {
      // JSON control frame (challenge / grant / kicked)
      const msg = JSON.parse(ev.data) as Record<string, unknown>;
      const kind = msg.kind;
      if (kind === "challenge") {
        const ch = msg as unknown as ChallengeMsg;
        this.sessionId = ch.sessionId;
        this.pendingChallenge = ch.nonce;
        if (this.signingKey) this.answerChallenge(ch.nonce);
        return;
      }
      if (kind === "session_grant") {
        const g = msg as unknown as GrantMsg;
        this.grant = g;
        this.sessionId = g.sessionId;
        this.pendingChallenge = null;
        this.baselineAcked = false;
        if (this.resolvingGrant) {
          const resolve = this.resolvingGrant;
          this.resolvingGrant = null;
          this.rejectingGrant = null;
          resolve(g);
        }
        return;
      }
      if (kind === "kicked") {
        this.onKicked?.(String(msg.reason ?? "superseded"));
      }
      return;
    }
    // binary: baseline snapshot or replica batch
    const snapshot = decode(ev.data as ArrayBuffer) as unknown as SnapshotProto;
    // The grant (text frame) always arrives before the baseline (binary), so
    // ack the baseline exactly once on the first binary frame after grant.
    if (this.grant !== null && !this.baselineAcked) {
      this.baselineAcked = true;
      this.sendBaselineAck(snapshot.baselineId);
    }
    this.onSnapshot?.(snapshot);
    if (this.grant !== null && this.onReady) {
      const once = this.onReady;
      this.onReady = null;
      once();
    }
  };

  private sendBaselineAck(baselineId: number): void {
    this.ws.send(encode({ protocol: 1, kind: "baseline_ack", baselineId }));
  }

  /**
   * Send a gameplay intent envelope. All M2 intents piggyback on the 30 Hz
   * move intent (inputs, never outcomes — GDD §21.4).
   */
  send(cmd: {
    wishX: number;
    wishZ: number;
    jump: boolean;
    crouch: boolean;
    sprint: boolean;
    inWater: boolean;
    yawHundredths: number;
    pitchHundredths: number;
    swing?: { targetEntityId: string };
    pickup?: { sourceEntityId: string };
    drop?: { slot: number };
    moveItem?: { from: number; to: number; equip?: "helmet" | "vest" | "pants" | "boots" };
    /** M3: start a craft (hand, or at the given station) */
    craft?: { recipeId: string; structureEntityId?: string };
    /** M3: research an item into its blueprint at a workbench */
    research?: { structureEntityId: string; itemId: string };
    /** M3: place the structure item in `slot` at a quantized position */
    place?: { slot: number; position: { x: number; y: number; z: number } };
    /** M4: deposit/withdraw stacks with a storage structure; rest at a sleeping bag */
    deposit?: { structureEntityId: string; fromSlot: number; toSlot: number };
    withdraw?: { structureEntityId: string; fromSlot: number; toSlot: number };
    rest?: { structureEntityId: string };
    /** M5: start a food/med channel from a grid slot */
    channel?: { slot: number; kind: "food" | "bandage" | "medkit" | "antirad" };
    heldSlot?: number;
  }): void {
    if (this.ws.readyState !== WebSocket.OPEN || !this.grant) return;
    this.sequence += 1;
    this.clientTick += 1;
    const command: ClientCommandProto = { kind: "move", ...cmd };
    const envelope: ClientEnvelopeProto = {
      protocol: 1,
      sessionId: this.grant.sessionId,
      sequence: this.sequence,
      clientTick: this.clientTick,
      commands: [command],
    };
    this.ws.send(encode(envelope));
  }

  close(): void {
    this.ws.close();
  }
}
