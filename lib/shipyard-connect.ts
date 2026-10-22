// Connect Shipyard: PKCE, state, and encrypted key storage for Dock.
// Server-only. Nothing here runs in the browser. The verifier is kept server-side
// (see the start route) and only its S256 challenge goes into the authorize URL.
import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const SHIPYARD_CLIENT_ID = "dock";
export const SHIPYARD_SCOPES = ["chat:write", "route:preview"] as const;

export function generateVerifier(): string {
  // 48 random bytes -> 64 base64url chars (RFC 7636 allows 43-128).
  return randomBytes(48).toString("base64url");
}

export function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function generateState(): string {
  return randomBytes(24).toString("base64url");
}

/** Constant-time equality. Returns false on any length mismatch. */
export function stateMatches(expected: string, received: string | null | undefined): boolean {
  if (!received || !expected) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(received);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function buildAuthorizeUrl(base: string, p: { redirectUri: string; state: string; challenge: string; workspace: string }): string {
  const u = new URL("/oauth/authorize", base);
  u.searchParams.set("client_id", SHIPYARD_CLIENT_ID);
  u.searchParams.set("redirect_uri", p.redirectUri);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("code_challenge", p.challenge);
  u.searchParams.set("code_challenge_method", "S256");
  u.searchParams.set("state", p.state);
  u.searchParams.set("workspace", p.workspace);
  u.searchParams.set("scope", SHIPYARD_SCOPES.join(" "));
  return u.toString();
}

/** AES-256-GCM. Key is 32 bytes, base64 in SHIPYARD_CONNECT_ENC_KEY. Output: v1.<iv>.<tag>.<ct>. */
function loadKey(b64: string): Buffer {
  const k = Buffer.from(b64, "base64");
  if (k.length !== 32) throw new Error("SHIPYARD_CONNECT_ENC_KEY must decode to 32 bytes");
  return k;
}

export function encryptSecret(plain: string, keyB64: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", loadKey(keyB64), iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64url"), c.getAuthTag().toString("base64url"), ct.toString("base64url")].join(".");
}

export function decryptSecret(blob: string, keyB64: string): string {
  const [v, iv, tag, ct] = blob.split(".");
  if (v !== "v1" || !iv || !tag || !ct) throw new Error("unrecognized ciphertext");
  const d = createDecipheriv("aes-256-gcm", loadKey(keyB64), Buffer.from(iv, "base64url"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(ct, "base64url")), d.final()]).toString("utf8");
}

/** Log-safe error text: strips anything that looks like a gateway key or bearer token. */
export function redactForLog(message: string): string {
  return message.replace(/sk-shipyard-[A-Za-z0-9_-]+/g, "sk-shipyard-[redacted]").replace(/Bearer\s+\S+/gi, "Bearer [redacted]");
}
