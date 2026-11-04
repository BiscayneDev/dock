import { NextResponse } from "next/server"
import { assistantContext, type AssistantContext } from "@/lib/assistant-store"
import { requireMobileOrOwner, resolveMobileOwnerContext } from "@/lib/mobile-auth-server"
import { listEventsForRuns } from "@/lib/queue"
import { buildApprovalCards, type ApprovalRunInput } from "@/lib/approval-card"

export const dynamic = "force-dynamic"

/**
 * Pending approval cards for the mobile app. Same card builder as the web UI
 * (lib/approval-card), so the phone renders the same proposal, target, amount
 * and budget the owner would see in Dock - never a blind run id.
 */
export async function GET(request: Request) {
  const denied = await requireMobileOrOwner(request, "runs:read")
  if (denied) return denied
  let ctx: AssistantContext | null = await assistantContext()
  if (!ctx) {
    const mobileCtx = await resolveMobileOwnerContext(request)
    if (!mobileCtx || "forbidden" in mobileCtx) {
      return NextResponse.json({ error: "Sign in required" }, { status: 401 })
    }
    ctx = mobileCtx
  }

  const { data, error } = await ctx.supabase
    .from("task_runs")
    .select("*")
    .eq("status", "awaiting_approval")
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
  const events = await listEventsForRuns(ctx.supabase, runs.map((r) => r.id))

  const projectIds = [...new Set(runs.map((r) => r.projectId).filter((x): x is string => !!x))]
  const projectNames: Record<string, string> = {}
  if (projectIds.length > 0) {
    const { data: projects } = await ctx.supabase.from("projects").select("id, name").in("id", projectIds)
    for (const p of (projects ?? []) as { id: string; name: string }[]) projectNames[p.id] = p.name
  }

  // Cards are built per conversation; the phone lists every pending approval.
  const cards = runs.flatMap((run) =>
    buildApprovalCards(
      [run],
      events.map((e) => ({ runId: e.runId, kind: e.kind, data: e.data, createdAt: e.createdAt })),
      null,
      projectNames,
    ),
  )
  return NextResponse.json({ cards })
}
