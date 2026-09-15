/**
 * Browser identity (GDD §22.4).
 *
 * - One ECDSA P-256 key pair per origin, generated lazily, its public JWK
 *   persisted to IndexedDB so reconnects (and server restarts) resolve to
 *   the same PlayerId = SHA-256(serverId + canonical JWK).
 * - The private key NEVER leaves the browser; the server receives only the
 *   public JWK inside the identity proof.
 * - The challenge nonce is signed with ES256 (Web Crypto returns the
 *   DER-encoded signature the Node.js server verifies with
 *   `crypto.verify("sha256", ...)`).
 */
export interface PublicJwk {
  kty: "EC";
  crv: "P-256";
  x: string;
  y: string;
  alg?: "ES256";
}

const DB_NAME = "dustfall-identity";
const STORE = "keys";
const RECORD = "player";

const b64url = (buf: ArrayBuffer | Uint8Array): string => {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i] ?? 0);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

export const fromB64url = (s: string): Uint8Array => {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
};

const openDb = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

/** Read the persisted public JWK (the identity survives reloads/restarts). */
export const loadIdentity = async (): Promise<PublicJwk | null> => {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE, "readonly");
    const row: unknown = await new Promise((res, rej) => {
      const q = tx.objectStore(STORE).get(RECORD);
      q.onsuccess = () => res(q.result);
      q.onerror = () => rej(q.error);
    });
    db.close();
    if (row && typeof row === "object" && "publicJwk" in row) return row.publicJwk as PublicJwk;
    return null;
  } catch {
    return null;
  }
};

/**
 * Ensure a key pair exists. If IndexedDB holds one, import it; otherwise
 * generate a fresh pair and persist the private JWK + public JWK. Returns
 * [publicJwk, signingKey].
 */
export const ensureIdentity = async (): Promise<[PublicJwk, CryptoKey]> => {
  const stored = await loadIdentity();
  if (stored) {
    try {
      const priv = await importPrivateJwk();
      if (priv) return [stored, priv];
    } catch {
      /* fall through: regenerate */
    }
  }
  const pair: CryptoKeyPair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ]);
  const pubJwk = (await crypto.subtle.exportKey("jwk", pair.publicKey)) as unknown as PublicJwk;
  const privJwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  try {
    const db = await openDb();
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put({ publicJwk: pubJwk, privateJwk: privJwk }, RECORD);
    await new Promise<void>((res, rej) => {
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
    db.close();
  } catch {
    /* non-persistent identity is still functional for this tab */
  }
  return [pubJwk, pair.privateKey];
};

/** Re-import the persisted private JWK (same origin, same key). */
const importPrivateJwk = async (): Promise<CryptoKey | null> => {
  try {
    const db = await openDb();
    const row: unknown = await new Promise((res, rej) => {
      const q = db.transaction(STORE, "readonly").objectStore(STORE).get(RECORD);
      q.onsuccess = () => res(q.result);
      q.onerror = () => rej(q.error);
    });
    db.close();
    if (!row || typeof row !== "object" || !("privateJwk" in row)) return null;
    const jwk = row.privateJwk as JsonWebKey;
    return await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, true, ["sign"]);
  } catch {
    return null;
  }
};

/** Sign the 32-byte challenge nonce; returns base64url DER (ES256). */
export const signChallenge = async (nonceB64url: string, key: CryptoKey): Promise<string> => {
  const sig = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    fromB64url(nonceB64url) as Uint8Array<ArrayBuffer>,
  );
  return b64url(sig);
};
