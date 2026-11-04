/**
 * Next.js-facing helpers for the scoped mobile token. Pure token logic lives in
 * ./mobile-auth (node-testable); this module adds session/Supabase plumbing.
 */
import { NextResponse } from "next/server"
import { assistantContext } from "./assistant-store"
import { adminClient, agentTokenWorkspace } from "./tenancy"
import { mobileTokenAuthorized, mobileTokenHas, type MobileCapability } from "./mobile-auth"

/**
 * Owner session, or the mobile token with the named capability.
 * Returns null when authorized, or a 401 to return directly.
 */
export async function requireMobileOrOwner(
  request: Request,
  capability: MobileCapability,
): Promise<NextResponse | null> {
  if (await assistantContext()) return null
  if (mobileTokenAuthorized(request) && mobileTokenHas(capability)) return null
  return NextResponse.json({ error: "Sign in required" }, { status: 401 })
}

/**
 * Supabase context for mobile-token requests that must act as the owner
 * (runs list, approval decisions). Same binding rule as the agent token:
 * single-workspace deployments only. Returns null when not a token request.
 */
export async function resolveMobileOwnerContext(request: Request) {
  if (!mobileTokenAuthorized(request)) return null
  const tokenWs = await agentTokenWorkspace()
  if (tokenWs === "forbidden") return { forbidden: true } as const
  const admin = adminClient()
  const { data: ws } = await admin
    .from("workspaces")
    .select("id, owner_id")
    .eq("id", tokenWs.workspaceId)
    .maybeSingle()
  if (!ws) return null
  return { supabase: admin, userId: ws.owner_id as string, workspaceId: ws.id as string }
}
