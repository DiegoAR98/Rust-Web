#!/usr/bin/env tsx
/**
 * Dustfall host entrypoint.
 * HTTP + WebSocket gateway on one port; 30 Hz simulation loop; 15 Hz replicas.
 *
 * M2 handshake flow (GDD §22.4):
 *   connect -> server JSON {challenge: {sessionId, nonce}}
 *           -> client msgpack {kind: "identity", publicKey, signature}
 *           -> server JSON session_grant + msgpack baseline snapshot
 *           -> client msgpack {kind: "baseline_ack", baselineId}
 *           -> Ready; gameplay envelopes (msgpack) accepted from here on.
 *
 * Reconnect within 5 minutes resumes the same player (body, inventory and
 * loot persist in the world); a newer identity socket invalidates the older.
 */
import { createServer } from "node:http";
import { join } from "node:path";
import { WebSocketServer, WebSocket, type RawData } from "ws";
import { decode } from "@msgpack/msgpack";
import { WorldRepository } from "@dustfall/persistence";
import { loadConfig, type ServerConfig } from "./config.js";
import { Host } from "./host.js";
import { HANDSHAKE_TIMEOUT_MS } from "./identity.js";

const config: ServerConfig = loadConfig();
// world seed: stable per world slot so restarts continue the same world
const seedA = 0x5eed;
const seedB = 0xbadd;
const host = new Host(`dustfall:${config.worldSlot}`, `world_${config.worldSlot}`, seedA, seedB, config.maxPlayers);

// persistence (GDD §21): SQLite world in the data dir; load on boot,
// autosave every 5 min + after death transactions, commit on clean shutdown
const repo = new WorldRepository(join(config.dataDir, `world_${config.worldSlot}.db`));
if (repo.hasWorld()) {
  const doc = repo.load();
  if (doc) {
    host.restoreFromSave(doc);
    console.log(`[server] restored world ${doc.worldId} at tick ${doc.clock.tick} (${doc.players.length} players, ${doc.entities.length} entities)`);
  }
}
let lastSaveTick = host.world.clock.tick;
const autosave = (): void => {
  try {
    repo.save(host.toSaveDocument());
    lastSaveTick = host.world.clock.tick;
  } catch (err) {
    console.error("[server] autosave failed:", err);
  }
};
// autosave cadence: 5 real minutes = 5 * 60 * 30 ticks (GDD §21)
const AUTOSAVE_TICKS = 5 * 60 * 30;
setInterval(() => {
  if (host.world.clock.tick - lastSaveTick >= AUTOSAVE_TICKS) autosave();
}, 5000);
// high-impact transaction: save immediately after a death commits (GDD §21)
host.onDeathCommitted(autosave);

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

wss.on("connection", (ws) => {
  const { sessionId, nonce } = host.beginHandshake();
  host.attachWriter(sessionId, (data, isBinary) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(data, { binary: isBinary });
  });
  sessionIdBySocket.set(ws, sessionId);

  // challenge (GDD §22.4): the client signs this nonce with its P-256 key
  ws.send(JSON.stringify({ protocol: 1, kind: "challenge", sessionId, nonce, serverTick: host.world.clock.tick, worldId: host.world.worldId }));

  ws.on("message", (data: RawData) => {
    const sessionId = sessionIdBySocket.get(ws);
    if (!sessionId) return;
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
    const msg = parsed as { kind?: unknown } | null;
    if (typeof msg === "object" && msg !== null && typeof msg.kind === "string") {
      if (msg.kind === "identity") {
        const r = host.submitIdentity(sessionId, msg);
        if (!r.ok) {
          console.warn(`[server] identity rejected for ${sessionId}: ${r.reason}`);
          if (r.reason === "bad_signature" || r.reason === "invalid_jwk") {
            ws.close(4001, "identity_rejected");
            return;
          }
        }
        return;
      }
      if (msg.kind === "baseline_ack") {
        const r = host.ackBaseline(sessionId, msg);
        if (!r.ok) console.warn(`[server] baseline ack rejected for ${sessionId}: ${r.reason}`);
        return;
      }
      if (msg.kind === "hello") {
        // late re-hello after a challenge the client missed; re-send it
        const s = host.sessions.get(sessionId);
        if (s?.nonce) ws.send(JSON.stringify({ protocol: 1, kind: "challenge", sessionId, nonce: s.nonce }));
        return;
      }
    }
    // gameplay envelope
    const result = host.receiveEnvelope(sessionId, parsed);
    if (!result.ok && (result.reason === "invalid_envelope" || result.reason === "session_mismatch")) {
      // GDD §22.6: invalid frames disconnect after 5 within 60 s
      console.warn(`[server] rejected frame from ${sessionId}: ${result.reason}`);
    }
  });

  const cleanup = (): void => {
    const sessionId = sessionIdBySocket.get(ws);
    sessionIdBySocket.delete(ws);
    if (!sessionId) return;
    // keep the session record for the 5-minute reconnect window; the player
    // body stays in the world (Sleeper policy, §22.5)
    host.detachWriter(sessionId);
    host.onDisconnect(sessionId);
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

// handshake timeout (GDD §22.6: 10 s) + stale disconnected session sweep
setInterval(() => {
  const now = Date.now();
  for (const s of host.sessions.all()) {
    if (s.state === "awaiting_identity" && now - s.connectedAtMs > HANDSHAKE_TIMEOUT_MS) {
      host.removeSession(s.id);
      for (const [ws, id] of sessionIdBySocket) {
        if (id === s.id && ws.readyState === WebSocket.OPEN) {
          ws.close(4002, "handshake_timeout");
          sessionIdBySocket.delete(ws);
        }
      }
    }
  }
}, 2000);

let shuttingDown = false;
const shutdown = (): void => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log("[server] shutting down gracefully");
  wss.close();
  http.close();
  // GDD §21: commit the final world, checkpoint WAL, keep 3 backups, exit
  try {
    const doc = host.toSaveDocument();
    repo.save(doc);
    repo.backup();
    repo.close();
    console.log(`[server] world committed at tick ${doc.clock.tick}`);
  } catch (err) {
    console.error("[server] final save failed:", err);
  }
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

http.listen(config.port, config.host, () => {
  console.log(`[server] Dustfall host listening on ${config.host}:${config.port} (world=${config.worldSlot})`);
  const lan = "http://<LAN-address>:" + config.port;
  console.log(`[server] open ${lan}/ in a browser`);
});
