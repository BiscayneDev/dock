/**
 * Device (home node) rules. Pure functions only: no I/O and no path-alias imports, so the node tests can load
 * this file directly. The DB work lives in lib/devices.ts.
 *
 * Tokens: a device token is `dockdev.<deviceId>.<secret>`. The server stores only sha256(salt + ":" + secret)
 * with a per-row salt. The id part selects the row; the secret is compared in constant time.
 * Pairing codes: 8 characters from an unambiguous alphabet, shown as XXXX-XXXX, valid 10 minutes, single use.
 */
import { createHash, randomBytes, timingSafeEqual } from "crypto"

export const DEVICE_TOKEN_PREFIX = "dockdev"
/** A device is online when its last heartbeat is within this window. */
export const DEVICE_FRESH_MS = 120_000
/** How often the daemon heartbeats. Must be well under DEVICE_FRESH_MS. */
export const DEVICE_HEARTBEAT_MS = 30_000
export const PAIRING_TTL_MS = 10 * 60_000

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isDeviceOnline(lastSeenAt: string | Date | null | undefined, now: number = Date.now()): boolean {
  if (!lastSeenAt) return false
  const seen = new Date(lastSeenAt).getTime()
  return Number.isFinite(seen) && now - seen <= DEVICE_FRESH_MS && seen <= now + 60_000
}

/** Random pairing code, shown as XXXX-XXXX. */
export function newPairingCode(): string {
  const bytes = randomBytes(8)
  let out = ""
  for (let i = 0; i < 8; i += 1) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length]
  return `${out.slice(0, 4)}-${out.slice(4)}`
}

/** Normalizes user input (case, spaces, dashes) to the 8-character code, or null when malformed. */
export function normalizePairingCode(input: unknown): string | null {
  if (typeof input !== "string") return null
  const cleaned = input.toUpperCase().replace(/[\s-]/g, "")
  if (cleaned.length !== 8) return null
  for (const ch of cleaned) if (!CODE_ALPHABET.includes(ch)) return null
  return cleaned
}

export function hashPairingCode(code: string): string {
  const normalized = normalizePairingCode(code)
  if (!normalized) throw new Error("invalid pairing code")
  return createHash("sha256").update(`pair:${normalized}`, "utf8").digest("hex")
}

export function pairingRedeemable(
  pairing: { expiresAt: string | Date; usedAt: string | Date | null },
  now: number = Date.now(),
): boolean {
  if (pairing.usedAt) return false
  return new Date(pairing.expiresAt).getTime() > now
}

export function newDeviceSecret(): string {
  return randomBytes(32).toString("base64url")
}

export function newDeviceSalt(): string {
  return randomBytes(16).toString("hex")
}

export function hashDeviceSecret(salt: string, secret: string): string {
  return createHash("sha256").update(`${salt}:${secret}`, "utf8").digest("hex")
}

export function formatDeviceToken(deviceId: string, secret: string): string {
  return `${DEVICE_TOKEN_PREFIX}.${deviceId}.${secret}`
}

/** Splits a bearer token into id and secret. Null when it does not have the exact shape. */
export function parseDeviceToken(token: string | null | undefined): { deviceId: string; secret: string } | null {
  if (!token || token.length > 200) return null
  const parts = token.split(".")
  if (parts.length !== 3 || parts[0] !== DEVICE_TOKEN_PREFIX) return null
  const [, deviceId, secret] = parts
  if (!UUID.test(deviceId) || !/^[A-Za-z0-9_-]{20,100}$/.test(secret)) return null
  return { deviceId: deviceId.toLowerCase(), secret }
}

export function verifyDeviceSecret(salt: string, secret: string, expectedHash: string): boolean {
  const a = Buffer.from(hashDeviceSecret(salt, secret), "hex")
  const b = Buffer.from(expectedHash, "hex")
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b)
}

export interface DeviceRow {
  id: string
  workspace_id: string
  owner_id: string
  name: string
  token_salt: string | null
  token_hash: string | null
  revoked_at: string | null
  last_seen_at: string | null
}

export type DeviceAuth =
  | { ok: true; deviceId: string; ownerId: string; workspaceId: string; name: string }
  | { ok: false; reason: "missing" | "malformed" | "unknown" | "not_paired" | "revoked" | "bad_secret" }

/**
 * Authenticates a device bearer token against a row loaded by id. The loader is injected so the rules can be
 * tested with fakes; production passes a service-role lookup.
 */
export function authenticateDeviceToken(
  token: string | null | undefined,
  row: DeviceRow | null,
): DeviceAuth {
  if (!token) return { ok: false, reason: "missing" }
  const parsed = parseDeviceToken(token)
  if (!parsed) return { ok: false, reason: "malformed" }
  if (!row || row.id.toLowerCase() !== parsed.deviceId) return { ok: false, reason: "unknown" }
  if (row.revoked_at) return { ok: false, reason: "revoked" }
  if (!row.token_salt || !row.token_hash) return { ok: false, reason: "not_paired" }
  if (!verifyDeviceSecret(row.token_salt, parsed.secret, row.token_hash)) return { ok: false, reason: "bad_secret" }
  return { ok: true, deviceId: row.id, ownerId: row.owner_id, workspaceId: row.workspace_id, name: row.name }
}

export function deviceWorkerId(deviceId: string): string {
  return `device:${deviceId}`
}

/** Event kinds a device may append to a run it holds. Anything else is refused. */
export const DEVICE_EVENT_KINDS = [
  "started",
  "heartbeat",
  "progress",
  "model_call",
  "local_tools",
  "note",
  "action_refused",
] as const

export function isDeviceEventKind(kind: unknown): kind is (typeof DEVICE_EVENT_KINDS)[number] {
  return typeof kind === "string" && (DEVICE_EVENT_KINDS as readonly string[]).includes(kind)
}

/** Statuses a device may move a run it holds to. Enforced in the complete route. */
export const DEVICE_COMPLETE_STATUSES = ["succeeded", "failed", "cancelled", "awaiting_approval"] as const

export function allowedDeviceCompletion(current: string, next: string): boolean {
  if (!["leased", "running"].includes(current)) return false
  return (DEVICE_COMPLETE_STATUSES as readonly string[]).includes(next)
}
