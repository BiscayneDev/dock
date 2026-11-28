// Pure invite helpers. Deliberately import-free so `node --test test/*.test.mjs`
// can type-strip and load this file directly (same pattern as lib/tool-permissions.ts).
// Nothing here reads env, cookies, the network, or a database.

export const DEFAULT_INVITE_TTL_DAYS = 7
export const MAX_EMAIL_LENGTH = 254
export const MAX_TOKEN_LENGTH = 200
export const MAX_INVITES_LISTED = 50

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/
const DAY_MS = 86_400_000

export type InviteErrorCode = "invalid_email" | "invalid_ttl" | "invalid_origin" | "invalid_token"

export type InviteResult<T> = { ok: true; value: T } | { ok: false; code: InviteErrorCode; error: string }

export type InviteStatus = "pending" | "used" | "expired"

function ok<T>(value: T): InviteResult<T> {
  return { ok: true, value }
}

function fail<T>(code: InviteErrorCode, error: string): InviteResult<T> {
  return { ok: false, code, error }
}

/** Trim, lowercase and syntax-check an invitee email. Never throws. */
export function normalizeInviteEmail(raw: unknown): InviteResult<string> {
  if (typeof raw !== "string") return fail("invalid_email", "Enter a valid email address.")
  const email = raw.trim().toLowerCase()
  if (!email || email.length > MAX_EMAIL_LENGTH || !EMAIL_PATTERN.test(email)) {
    return fail("invalid_email", "Enter a valid email address.")
  }
  return ok(email)
}

/** Invite lifetime in ms. Omit `days` for the 7-day default; non-finite or non-positive values are rejected. */
export function inviteTtlMs(days: unknown = DEFAULT_INVITE_TTL_DAYS): InviteResult<number> {
  if (typeof days !== "number" || !Number.isFinite(days) || days <= 0) {
    return fail("invalid_ttl", "Invite lifetime must be a positive number of days.")
  }
  return ok(days * DAY_MS)
}

/** True for the 32-byte base64url tokens produced by newInviteToken(). */
export function isInviteTokenShape(token: unknown): boolean {
  return typeof token === "string" && TOKEN_SHAPE.test(token)
}

/**
 * Build `${origin}/login?invite=<token>` with the token encoded exactly once.
 * Only bare http(s) origins are accepted (no path, query, hash or credentials),
 * so the result cannot be turned into an off-site link by a crafted input.
 */
export function inviteShareUrl(origin: unknown, token: unknown): InviteResult<string> {
  if (typeof token !== "string" || !token || token.length > MAX_TOKEN_LENGTH || /\s/.test(token)) {
    return fail("invalid_token", "Invite token is not valid.")
  }
  if (typeof origin !== "string" || !origin.trim()) {
    return fail("invalid_origin", "Invite origin is not valid.")
  }
  let parsed: URL
  try {
    parsed = new URL(origin)
  } catch {
    return fail("invalid_origin", "Invite origin is not valid.")
  }
  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    (parsed.pathname !== "/" && parsed.pathname !== "")
  ) {
    return fail("invalid_origin", "Invite origin is not valid.")
  }
  return ok(`${parsed.origin}/login?invite=${encodeURIComponent(token)}`)
}

/** Display status only; used/expired take precedence over pending. */
export function inviteStatus(row: { used_at?: string | null; expires_at: string }, nowMs: number = Date.now()): InviteStatus {
  if (row.used_at) return "used"
  const expires = new Date(row.expires_at).getTime()
  return !Number.isFinite(expires) || expires <= nowMs ? "expired" : "pending"
}
