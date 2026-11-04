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
  "runs:read",
  "runs:create",
  "runs:decide",
] as const

export type MobileCapability = (typeof MOBILE_CAPABILITIES)[number]

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest()
}

export function presentedMobileToken(request: Request): string {
  const authorization = request.headers.get("authorization") ?? ""
  const bearer = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : ""
  return bearer || (request.headers.get("x-dock-mobile-token") ?? "").trim()
}

/**
 * Env-token fast-path: the owner-configured DOCK_MOBILE_TOKEN (escape hatch /
 * single-phone deployments). Paired-device credentials are checked separately
 * by the server helper (./mobile-auth-server), which owns the store lookup.
 */
export function mobileEnvTokenAuthorized(request: Request): boolean {
  const provided = presentedMobileToken(request)
  if (!provided) return false
  const expected = (process.env.DOCK_MOBILE_TOKEN ?? "").trim()
  return !!expected && timingSafeEqual(digest(provided), digest(expected))
}

export function mobileTokenHas(capability: MobileCapability): boolean {
  return MOBILE_CAPABILITIES.includes(capability)
}
