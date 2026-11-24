import { NextResponse } from "next/server"
import { assistantContext, isUuid } from "@/lib/assistant-store"
import { recordRunVerdict } from "../../../decisions/store"

export const dynamic = "force-dynamic"

interface Context {
  params: Promise<{ id: string }>
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const parsed: unknown = await request.json()
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>
  } catch {
    // No body is allowed for backward compatibility; the inbox always sends a reason.
  }
  return {}
}

/**
 * Owner rejection of a run parked in awaiting_approval. The ledger requires a reason on the
 * changes_requested path; this legacy endpoint keeps working without one and records a default.
 * The run still moves only through decideApproval.
 */
export async function POST(request: Request, context: Context) {
  const ctx = await assistantContext()
  if (!ctx) return NextResponse.json({ error: "Sign in required" }, { status: 401 })
  const { id } = await context.params
  if (!isUuid(id)) return NextResponse.json({ error: "Run not found" }, { status: 404 })

  const body = await readBody(request)
  const artifactHash = typeof body.artifactHash === "string" && body.artifactHash ? body.artifactHash : null
  const reason = typeof body.reason === "string" ? body.reason : null
  const result = await recordRunVerdict(ctx.supabase, {
    userId: ctx.userId,
    runId: id,
    decision: "reject",
    reason,
    artifactHash,
  })
  if (!result.ok) return NextResponse.json({ error: result.reason }, { status: result.httpStatus })
  return NextResponse.json({ id, status: result.runStatus, decisionId: result.decisionId })
}
