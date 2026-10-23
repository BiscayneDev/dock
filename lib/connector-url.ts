/**
 * The one-tap Dinghy connect link shown next to the pairing code in Settings. Pure functions only
 * (no I/O, no path aliases) so node:test can load this file directly.
 *
 * The link carries the one-time pairing code plus a workspace hint SIGNED with the webhook secret the
 * two products already share (sig = HMAC-SHA256 of "<code>.<workspace>", hex). Dinghy shows its consent
 * page either way, but only a valid signature unlocks the owner's "Always allow" auto-reconnect - an
 * unsigned or forged hint can never skip consent. The signature is over the exact dashed code string
 * that appears in the URL, which is what Dinghy verifies.
 */
import { createHmac } from "crypto"

// www is canonical: the apex 308-redirects to www (same rule as the webhook sender).
export const DINGHY_DEFAULT_CONNECT_URL = "https://www.getdinghy.sh/connect/dock"

/** HMAC-SHA256 hex over `${code}.${workspaceId}`. Must match Dinghy's verifyConnectHint. */
export function signConnectHint(secret: string, code: string, workspaceId: string): string {
  return createHmac("sha256", secret).update(`${code}.${workspaceId}`, "utf8").digest("hex")
}

export function buildDinghyConnectUrl(input: {
  code: string
  workspaceId: string
  base?: string
  secret?: string
}): string {
  const raw = (input.base ?? "").trim().replace(/\/+$/, "")
  const url = new URL(raw || DINGHY_DEFAULT_CONNECT_URL)
  url.searchParams.set("pair", input.code)
  if (input.secret) {
    url.searchParams.set("w", input.workspaceId)
    url.searchParams.set("sig", signConnectHint(input.secret, input.code, input.workspaceId))
  }
  return url.toString()
}
