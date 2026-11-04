/**
 * Scoped mobile auth (DOCK_MOBILE_TOKEN).
 *
 * The agent token is a per-instance superuser credential: it activates runs,
 * posts notifications, writes activity. The owner's phone does not need that
 * blast radius, so the mobile client authenticates with a separate token whose
 * access is the explicit capability list below - the read/decide surface the
 * app needs, and nothing else. Owner session always passes. Fail closed: no
 * configured token, wrong token, or an unlisted capability is a 401.
 *
 * Token requests bind to the deployment's single workspace owner, mirroring
 * the agent-token tenancy rule: multi-workspace deployments reject token auth
 * instead of silently reading across workspaces.
 */
import { createHash, timingSafeEqual } from "crypto"

export const MOBILE_CAPABILITIES = [
  "tasks:read",
  "tasks:write",
  "tasks:activate",
  "repos:read",
  "worktree:read",
  "messages:read",
  "messages:write",
  "runs:read",
  "runs:decide",
  "push:register",
] as const

export type MobileCapability = (typeof MOBILE_CAPABILITIES)[number]

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest()
}

/** True when the request carries a valid DOCK_MOBILE_TOKEN bearer/x-dock-mobile-token header. */
export function mobileTokenAuthorized(request: Request): boolean {
  const expected = (process.env.DOCK_MOBILE_TOKEN ?? "").trim()
  if (!expected) return false
  const authorization = request.headers.get("authorization") ?? ""
  const bearer = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : ""
  const provided = bearer || (request.headers.get("x-dock-mobile-token") ?? "").trim()
  if (!provided) return false
  return timingSafeEqual(digest(provided), digest(expected))
}

export function mobileTokenHas(capability: MobileCapability): boolean {
  return MOBILE_CAPABILITIES.includes(capability)
}

