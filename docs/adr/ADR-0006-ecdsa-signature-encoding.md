# ADR-0006: ECDSA P-256 signature encoding (Web Crypto raw → DER)

**Status:** accepted (2026-09-15)
**Deciders:** Diego Araujo (Dustfall dev)

## Context

GDD §22.4 specifies the identity handshake: the browser generates an ECDSA
P-256 key pair, the server sends a 32-byte nonce, the client signs it, and
the server verifies the signature. The GDD (and the protocol schema,
`IdentityProofSchema.signature`) treats the wire value as a
**DER-encoded ES256** signature, base64url.

The signature is produced in the browser with Web Crypto
(`crypto.subtle.sign({name:"ECDSA", hash:"SHA-256"}, …)`). Per the Web Crypto
spec that call returns the signature in **IEEE P1363 "raw" form** — a
64-byte concatenation `R || S` — *not* DER. The server verifies with Node's
`crypto.verify("sha256", …)`, which only accepts **DER** (SEC 1) for ECDSA.

So the raw bytes the browser produces are directly unusable by the server,
and passing them through verbatim yields a structurally-invalid signature
(leading byte `0x58`/`0x39`… instead of `0x30`).

## Decision

The client converts the raw `R || S` to DER before sending, so the wire
contract stays exactly as the GDD describes (DER-encoded ES256). The
conversion (`rawToDer` in `apps/client/src/identity.ts`):

- Split the 64 bytes into `R = raw[0:32]`, `S = raw[32:64]`.
- Encode each as a DER `INTEGER`: strip leading `0x00` bytes, then prefix a
  `0x00` if the most-significant bit is set (keeps the value positive).
- Wrap in a `SEQUENCE`: `0x30 <len> 0x02 <rlen> R 0x02 <slen> S`.
- The SEQUENCE length byte is `2 + rlen + 2 + slen` (both INTEGER
  tag+length headers included). For P-256 this is always ≤ 127, so a single
  length byte suffices.

The server side is unchanged: `verifyProof` imports the public JWK and calls
`crypto.verify("sha256", nonce, key, derSig)`.

## Alternatives considered

- **Make the server accept raw signatures.** Web Crypto does not offer a way
  to ask for DER directly, and the GDD/schema already fix the wire to DER.
  Changing the server to parse raw would diverge from the documented
  protocol and complicate the schema (raw is exactly 64 bytes, but the DER
  bounds `44..80` already in the schema fit DER naturally). Rejected.
- **Do the raw→DER conversion on the server from raw bytes.** Would change
  the wire contract to raw and require schema changes; it also puts
  signature-shape logic server-side where the browser already owns it.
  Rejected.

## Consequences

- The browser is the single place that knows its platform returns raw; the
  node-based smoke/E2E clients sign with `crypto.sign` (already DER) and
  send it directly, so they skip the conversion.
- The protocol schema's signature bounds (`min 43, max 120` base64url chars)
  comfortably contain a P-256 DER signature (~70 bytes → ~94 chars).
- If a future client platform's Web Crypto ever returns DER directly,
  `rawToDer` is a no-op misstep — it would need a guard detecting an
  already-DER input (leading `0x30`). Not required today (spec says raw).
