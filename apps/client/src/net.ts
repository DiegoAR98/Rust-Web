/**
 * WebSocket gateway: JSON hello, binary msgpack envelopes/snapshots.
 */
import { encode, decode } from "@msgpack/msgpack";
import type { ClientEnvelopeProto, SnapshotProto } from "@dustfall/protocol";

export class GameSocket {
  private ws: WebSocket;
  private sequence = 0;
  private clientTick = 0;
  private sessionId = "";
  onSnapshot: ((s: SnapshotProto) => void) | null = null;
  onHello: (() => void) | null = null;

  constructor(url: string) {
    this.ws = new WebSocket(url);
    // Binary gameplay frames are msgpack over an ArrayBuffer (GDD §21.7).
    // The browser default is "blob", which decode() cannot read.
    this.ws.binaryType = "arraybuffer";
  }

  get ready(): boolean {
    return this.ws.readyState === WebSocket.OPEN && this.sessionId !== "";
  }

  private onOpen = (): void => {
    // wait for server hello
  };

  private onMessage = (ev: MessageEvent): void => {
    if (typeof ev.data === "string") {
      const hello = JSON.parse(ev.data) as { protocol: number; serverTick: number; worldId: string; sessionId?: string };
      if (hello.sessionId) this.sessionId = hello.sessionId;
      this.onHello?.();
      return;
    }
    const snapshot = decode(ev.data as ArrayBuffer) as unknown as SnapshotProto;
    this.onSnapshot?.(snapshot);
  };

  private onError = (ev: Event): void => {
    console.error("socket error", ev);
  };

  start(): void {
    this.ws.onopen = this.onOpen;
    this.ws.onmessage = this.onMessage;
    this.ws.onerror = this.onError;
  }

  sendMovement(cmd: {
    wishX: number;
    wishZ: number;
    jump: boolean;
    crouch: boolean;
    sprint: boolean;
    inWater: boolean;
    yawHundredths: number;
    pitchHundredths: number;
  }): void {
    if (this.ws.readyState !== WebSocket.OPEN) return;
    this.sequence += 1;
    this.clientTick += 1;
    const envelope: ClientEnvelopeProto = {
      protocol: 1,
      sessionId: this.sessionId,
      sequence: this.sequence,
      clientTick: this.clientTick,
      commands: [{ kind: "move", ...cmd }],
    };
    this.ws.send(encode(envelope));
  }

  close(): void {
    this.ws.close();
  }
}
