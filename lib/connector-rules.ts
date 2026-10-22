/**
 * Dinghy connector rules. Pure functions only (no I/O, no path aliases) so node:test can load this file directly.
 * The DB work lives in lib/connector.ts; webhook delivery lives in lib/connector-webhook.ts.
 *
 * Hashing mirrors lib/device-rules.ts exactly: sha256("<salt>:<secret>") with a per-row salt, plaintext shown once.
 * test/connector.test.mjs asserts the outputs match device-rules for the same inputs, so the two cannot drift.
 *
 * Tokens: `dockcon.<connectionId>.<secret>`. Pairing codes: 8 chars from the device alphabet, shown as XXXX-XXXX,
 * valid 10 minutes, single use. Approvals: 15 minutes to decide.
 */
import { createHash, randomBytes, timingSafeEqual } from "crypto"

export const CONNECTOR_TOKEN_PREFIX = "dockcon"
export const CONNECTOR_PAIRING_TTL_MS = 10 * 60_000
export const CONNECTOR_APPROVAL_TTL_MS = 15 * 60_000
export const CONNECTOR_REPLAY_WINDOW_SECONDS = 300

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function newConnectorPairingCode(): string {
  const bytes = randomBytes(8)
  let out = ""
  for (let i = 0; i < 8; i += 1) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length]
  return `${out.slice(0, 4)}-${out.slice(4)}`
}

/** Normalizes user input (case, spaces, dashes) to the 8-character code, or null when malformed. */
export function normalizeConnectorCode(input: unknown): string | null {
  if (typeof input !== "string") return null
  const cleaned = input.toUpperCase().replace(/[\s-]/g, "")
  if (cleaned.length !== 8) return null
  for (const ch of cleaned) if (!CODE_ALPHABET.includes(ch)) return null
  return cleaned
}

export function hashConnectorCode(code: string): string {
  const normalized = normalizeConnectorCode(code)
  if (!normalized) throw new Error("invalid pairing code")
  return createHash("sha256").update(`pair:${normalized}`, "utf8").digest("hex")
}

export function newConnectorSecret(): string {
  return randomBytes(32).toString("base64url")
}

export function newConnectorSalt(): string {
  return randomBytes(16).toString("hex")
}

export function hashConnectorSecret(salt: string, secret: string): string {
  return createHash("sha256").update(`${salt}:${secret}`, "utf8").digest("hex")
}

export function formatConnectorToken(connectionId: string, secret: string): string {
  return `${CONNECTOR_TOKEN_PREFIX}.${connectionId}.${secret}`
}

export function parseConnectorToken(token: string | null | undefined): { connectionId: string; secret: string } | null {
  if (!token || token.length > 200) return null
  const parts = token.split(".")
  if (parts.length !== 3 || parts[0] !== CONNECTOR_TOKEN_PREFIX) return null
  const [, connectionId, secret] = parts
  if (!UUID.test(connectionId) || !/^[A-Za-z0-9_-]{20,100}$/.test(secret)) return null
  return { connectionId: connectionId.toLowerCase(), secret }
}

export function verifyConnectorSecret(salt: string, secret: string, expectedHash: string): boolean {
  const a = Buffer.from(hashConnectorSecret(salt, secret), "hex")
  const b = Buffer.from(expectedHash, "hex")
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b)
}

export interface ConnectionRow {
  id: string
  workspace_id: string
  owner_id: string
  link_ref: string
  token_salt: string | null
  token_hash: string | null
  revoked_at: string | null
}

export type ConnectorAuth =
  | { ok: true; connectionId: string; workspaceId: string; ownerId: string; linkRef: string }
  | { ok: false; reason: "missing" | "malformed" | "unknown" | "revoked" | "not_paired" | "bad_secret" }

/** Authenticates a connector bearer token against a row loaded by id. Pure: the caller does the lookup. */
export function authenticateConnectorToken(token: string | null | undefined, row: ConnectionRow | null): ConnectorAuth {
  if (!token) return { ok: false, reason: "missing" }
  const parsed = parseConnectorToken(token)
  if (!parsed) return { ok: false, reason: "malformed" }
  if (!row || row.id.toLowerCase() !== parsed.connectionId) return { ok: false, reason: "unknown" }
  if (row.revoked_at) return { ok: false, reason: "revoked" }
  if (!row.token_salt || !row.token_hash) return { ok: false, reason: "not_paired" }
  if (!verifyConnectorSecret(row.token_salt, parsed.secret, row.token_hash)) return { ok: false, reason: "bad_secret" }
  return { ok: true, connectionId: row.id, workspaceId: row.workspace_id, ownerId: row.owner_id, linkRef: row.link_ref }
}

export interface ApprovalDetails {
  actionId: string
  type: string
  amountCents: number | null
  destination: string | null
  description: string | null
}

/**
 * Hash of the details the user is shown. Fixed key order, so the same details always hash the same.
 * Dinghy echoes this hash back on decide; any change to the underlying details makes the decision refused.
 */
export function approvalDetailsHash(d: ApprovalDetails): string {
  const canonical = JSON.stringify([d.actionId, d.type, d.amountCents, d.destination, d.description])
  return createHash("sha256").update(canonical, "utf8").digest("hex")
}

export type DecisionRefusal = "not_pending" | "expired" | "changed"

/**
 * Decides whether an approval may be decided now. Order matters: a decided approval is "not_pending" even if its
 * expiry has also passed. Returns null when the decision may proceed.
 */
export function decisionRefusal(input: {
  status: string
  expiresAt: string | Date
  now: number
  storedHash: string
  expectedHash: string
  currentHash: string | null
}): DecisionRefusal | null {
  if (input.status !== "pending") return "not_pending"
  if (new Date(input.expiresAt).getTime() <= input.now) return "expired"
  if (input.expectedHash !== input.storedHash) return "changed"
  if (input.currentHash === null || input.currentHash !== input.storedHash) return "changed"
  return null
}

