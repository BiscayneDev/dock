import { NextResponse } from "next/server"
import { assistantContext } from "@/lib/assistant-store"
import { listAudit, parseAuditQuery } from "@/lib/audit"

export const dynamic = "force-dynamic"

/**
 * GET /api/audit?limit=50&kind=... — who did what across surfaces, newest first.
 * Owner session only: the signed-in owner's RLS-scoped events joined to run attribution.
 * No DOCK_AGENT_TOKEN path (machine credentials are not an audit audience).
 */
export async function GET(request: Request) {
  const ctx = await assistantContext()
  if (!ctx) return NextResponse.json({ error: "Sign in required" }, { status: 401 })
  try {
    const entries = await listAudit(ctx.supabase, parseAuditQuery(request.url))
    return NextResponse.json({ entries })
  } catch {
    return NextResponse.json({ error: "Audit lookup failed" }, { status: 500 })
  }
}
