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
    // No body is allowed: the legacy card approves without one.
  }
  return {}
}

/**
 * Owner approval of a money action parked in awaiting_approval. The verdict is bound to the
 * artifact hash the card showed; a stale card is refused. The run still moves only through
 * decideApproval, and agent callbacks still cannot reach this owner-session route.
 */
export async function POST(request: Request, context: Context) {
  const ctx = await assistantContext()
  if (!ctx) return NextResponse.json({ error: "Sign in required" }, { status: 401 })
  const { id } = await context.params
  if (!isUuid(id)) return NextResponse.json({ error: "Run not found" }, { status: 404 })

  const body = await readBody(request)
  const artifactHash = typeof body.artifactHash === "string" && body.artifactHash ? body.artifactHash : null
  const result = await recordRunVerdict(ctx.supabase, {
    userId: ctx.userId,
    runId: id,
    decision: "approve",
    artifactHash,
  })
  if (!result.ok) return NextResponse.json({ error: result.reason }, { status: result.httpStatus })
  return NextResponse.json({ id, status: result.runStatus, decisionId: result.decisionId })
}
