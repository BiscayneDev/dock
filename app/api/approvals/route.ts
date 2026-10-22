import { NextResponse } from "next/server"
import { assistantContext, isUuid } from "@/lib/assistant-store"
import { listEventsForRuns } from "@/lib/queue"
import { buildApprovalCards, type ApprovalRunInput } from "@/lib/approval-card"

export const dynamic = "force-dynamic"

/**
 * Approval cards for one assistant conversation: GET /api/approvals?conversation=<uuid>.
 * Owner session only (RLS limits rows to the caller's runs). Signed out = 401.
 */
export async function GET(request: Request) {
  const ctx = await assistantContext()
  if (!ctx) return NextResponse.json({ error: "Sign in required" }, { status: 401 })
  const conversationId = new URL(request.url).searchParams.get("conversation") ?? ""
  if (!isUuid(conversationId)) return NextResponse.json({ error: "Invalid conversation" }, { status: 400 })

  const { data, error } = await ctx.supabase
    .from("task_runs")
    .select("*")
    .eq("payload->>conversationId", conversationId)
    .order("created_at", { ascending: false })
    .limit(50)
  if (error) return NextResponse.json({ error: "Could not load approvals" }, { status: 500 })

  const rows = (data ?? []) as Record<string, unknown>[]
  const runs: ApprovalRunInput[] = rows.map((r) => {
    const payload = (r.payload as Record<string, unknown>) ?? {}
    return {
      id: r.id as string,
      status: r.status as string,
      conversationId: typeof payload.conversationId === "string" ? payload.conversationId : null,
      projectId: (r.project_id as string | null) ?? null,
      model: (r.model as string | null) ?? null,
      budgetCents: (r.budget_cents as number) ?? 0,
      payload,
    }
  })
  const runIds = runs.map((r) => r.id)
  const events = await listEventsForRuns(ctx.supabase, runIds)

  const projectIds = [...new Set(runs.map((r) => r.projectId).filter((x): x is string => !!x))]
  const projectNames: Record<string, string> = {}
  if (projectIds.length > 0) {
    const { data: projects } = await ctx.supabase.from("projects").select("id, name").in("id", projectIds)
    for (const p of (projects ?? []) as { id: string; name: string }[]) projectNames[p.id] = p.name
  }

  return NextResponse.json({
    cards: buildApprovalCards(
      runs,
      events.map((e) => ({ runId: e.runId, kind: e.kind, data: e.data, createdAt: e.createdAt })),
      conversationId,
      projectNames,
    ),
  })
}
