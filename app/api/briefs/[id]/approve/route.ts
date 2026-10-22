import { NextResponse } from "next/server"
import { assistantContext, isUuid } from "@/lib/assistant-store"
import { approveBrief, BriefConflictError, CapExceededError, maxBriefBudgetCents } from "@/lib/briefs-store"

export const dynamic = "force-dynamic"

/** The owner's approval is the only thing that turns a brief into a run. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await assistantContext()
  if (!ctx) return NextResponse.json({ error: "Sign in required" }, { status: 401 })
  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: "Not found" }, { status: 404 })
  try {
    const { brief, run } = await approveBrief(ctx.supabase, { workspaceId: ctx.workspaceId, ownerId: ctx.userId }, id, maxBriefBudgetCents())
    return NextResponse.json({ brief, runId: run.id }, { status: 201 })
  } catch (error) {
    if (error instanceof BriefConflictError || error instanceof CapExceededError) {
      return NextResponse.json({ error: error.message }, { status: 409 })
    }
    if (error instanceof Error && error.message === "not_found") return NextResponse.json({ error: "Not found" }, { status: 404 })
    return NextResponse.json({ error: error instanceof Error ? error.message : "Approval failed" }, { status: 500 })
  }
}
