/**
 * Player identity and session tokens (GDD §22.4).
 *
 * - The browser owns an ECDSA P-256 key pair (Web Crypto, IndexedDB);
 *   the server stores/accepts ONLY the public JWK.
 * - `PlayerId = SHA-256(serverId + canonical JWK)` (base16, `p_` prefixed).
 * - Login: server 32-byte nonce -> client ES256 signature -> verify.
 * - After success the server issues a 24-hour HMAC-SHA-256 session token
 *   scoped to (serverId, playerId, sessionId). Tokens never appear in
 *   URLs or logs; they are revocable in-memory.
 * - Reconnect within five minutes resumes the same session (GDD §22.6).
 */
import { createHmac, createHash, createPublicKey, randomBytes, timingSafeEqual, verify } from "node:crypto";
import type { JwkProto } from "@dustfall/protocol";

export const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 h
export const RECONNECT_WINDOW_MS = 5 * 60 * 1000; // 5 min
export const HANDSHAKE_TIMEOUT_MS = 10 * 1000; // 10 s (GDD §22.6)

/** Canonical JWK: kty, crv, x, y (plus alg when present), sorted keys. */
export const canonicalJwk = (jwk: JwkProto): string => {
  const fields: Record<string, string> = { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y };
  if (jwk.alg) fields.alg = jwk.alg;
  return JSON.stringify(fields, Object.keys(fields).sort());
};

export const derivePlayerId = (serverId: string, jwk: JwkProto): string =>
  "p_" + createHash("sha256").update(serverId + canonicalJwk(jwk)).digest("hex").slice(0, 20);

/** Random 32-byte nonce, base64url (unpadded) for the challenge. */
export const freshNonce = (): string => randomBytes(32).toString("base64url");

/**
 * Verify an ES256 (DER) signature over `nonceB64url` with the public JWK.
 * Throws on malformed JWK/signature; returns false on bad signature.
 */
export const verifyProof = (jwk: JwkProto, nonceB64url: string, sigB64url: string): boolean => {
  let key: ReturnType<typeof createPublicKey>;
  try {
    key = createPublicKey({ key: { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y }, format: "jwk" });
  } catch {
    return false;
  }
  const sig = Buffer.from(sigB64url, "base64url");
  if (sig.length < 44 || sig.length > 80) return false; // DER overhead bounds
  return verify("sha256", Buffer.from(nonceB64url, "base64url"), key, sig);
};

/** 24-hour session token: HMAC-SHA-256(serverId|playerId|sessionId|expiry), base64url. */
export const issueSessionToken = (serverId: string, playerId: string, sessionId: string, secret: string): string => {
  const expiresAt = Date.now() + SESSION_TTL_MS;
  const mac = createHmac("sha256", secret).update(`${serverId}|${playerId}|${sessionId}|${expiresAt}`).digest("base64url");
  return `${expiresAt}.${mac}`;
};

export const verifySessionToken = (
  serverId: string,
  playerId: string,
  sessionId: string,
  token: string,
  secret: string,
): boolean => {
  const dot = token.indexOf(".");
  if (dot < 0) return false;
  const expiresAt = Number(token.slice(0, dot));
  if (!Number.isInteger(expiresAt) || expiresAt < Date.now()) return false;
  const expected = createHmac("sha256", secret).update(`${serverId}|${playerId}|${sessionId}|${expiresAt}`).digest("base64url");
  const provided = token.slice(dot + 1);
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
};
