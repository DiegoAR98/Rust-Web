#!/usr/bin/env tsx
/**
 * Dustfall host entrypoint.
 * HTTP + WebSocket gateway on one port; 30 Hz simulation loop; 15 Hz replicas.
 */
import { createServer } from "node:http";
import { WebSocketServer, WebSocket, type RawData } from "ws";
import { decode } from "@msgpack/msgpack";
import { loadConfig, type ServerConfig } from "./config.js";
import { Host } from "./host.js";
import { type Session } from "./session.js";

const config: ServerConfig = loadConfig();
// world seed: stable per world slot so restarts continue the same world
const seedA = 0x5eed; // placeholder until M-1B persistence seeds it
const seedB = 0xbadd;
const host = new Host(`world_${config.worldSlot}`, seedA, seedB, config.maxPlayers);

const http = createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, tick: host.world.clock.tick, players: host.sessions.size() }));
    return;
  }
  res.writeHead(404);
  res.end("not found");
});

const wss = new WebSocketServer({ server: http, maxPayload: 16 * 1024 });

const sessionIdBySocket = new Map<WebSocket, string>();
let nextSession = 1;

wss.on("connection", (ws) => {
  const sessionId = `s_${nextSession++}`;
  const session: Session = {
    id: sessionId,
    playerId: `p_${sessionId}`,
    state: "connecting",
    ackInputSequence: 0,
    pending: [],
    joinedAtTick: 0,
    queuedBytes: 0,
    backpressureSince: null,
  };
  host.sessions.add(session);
  sessionIdBySocket.set(ws, sessionId);

  // handshake: JSON hello carries the session id so envelopes can reference it
  ws.send(JSON.stringify({ protocol: 1, sessionId, serverTick: host.world.clock.tick, worldId: host.world.worldId }));
  session.state = "awaiting_baseline";
  host.attachWriter(sessionId, (data, isBinary) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(data, { binary: isBinary });
  });
  host.spawnPlayer(sessionId, session.playerId);

  ws.on("message", (data: RawData) => {
    let buf: Buffer;
    if (Buffer.isBuffer(data)) buf = data;
    else if (Array.isArray(data)) buf = Buffer.concat(data);
    else buf = Buffer.from(data as ArrayBuffer);
    let parsed: unknown;
    try {
      parsed = decode(buf);
    } catch {
      ws.close(4000, "invalid_frame");
      return;
    }
    const result = host.receiveEnvelope(sessionId, parsed);
    if (!result.ok && (result.reason === "invalid_envelope" || result.reason === "session_mismatch")) {
      // GDD §22.6: invalid frames disconnect after 5 within 60 s
      console.warn(`[server] rejected frame from ${sessionId}: ${result.reason}`);
    }
  });

  const cleanup = (): void => {
    host.detachWriter(sessionId);
    host.sessions.remove(sessionId);
    sessionIdBySocket.delete(ws);
  };
  ws.on("close", cleanup);
  ws.on("error", cleanup);
});

// 30 Hz simulation loop; at most 5 catch-up ticks per frame (GDD §21.5)
const TICK_MS = 1000 / 30;
let last = Date.now();
let acc = 0;
setInterval(() => {
  const now = Date.now();
  acc += now - last;
  last = now;
  let ticks = 0;
  while (acc >= TICK_MS && ticks < 5) {
    host.tick();
    acc -= TICK_MS;
    ticks += 1;
  }
  if (ticks === 5) acc = 0; // drop the backlog, record overrun
}, TICK_MS);

const shutdown = (): void => {
  console.log("[server] shutting down gracefully");
  wss.close();
  http.close();
  // M-1B: commit last tick + WAL checkpoint here
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

http.listen(config.port, config.host, () => {
  console.log(`[server] Dustfall host listening on ${config.host}:${config.port} (world=${config.worldSlot})`);
  const lan = "http://<LAN-address>:" + config.port;
  console.log(`[server] open ${lan}/ in a browser`);
});
