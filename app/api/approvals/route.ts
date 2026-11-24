import { NextResponse } from "next/server"
import { assistantContext, isUuid } from "@/lib/assistant-store"
import { listEventsForRuns } from "@/lib/queue"
import { buildApprovalCards, type ApprovalRunInput } from "@/lib/approval-card"
import { syncRunDecisions } from "../decisions/store"

export const dynamic = "force-dynamic"

interface DecisionLinkRow {
  id: string
  requested_by_run: string
  artifact_hash: string
  status: string
  kind: string
}

/**
 * Approval cards for one assistant conversation: GET /api/approvals?conversation=<uuid>.
 * Owner session only (RLS limits rows to the caller's runs). Signed out = 401.
 *
 * Every card is linked back to its decision-ledger row so the verdict can be bound to the exact
 * artifact hash. The card shape itself is unchanged; the ledger fields are additive.
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

  // Materialize a ledger decision for any awaiting_approval run that does not have one yet, so the
  // card carries a stable artifact hash before the owner clicks.
  try {
    const eventsByRun = new Map<string, Array<{ kind: string; data: Record<string, unknown> }>>()
    for (const e of events) {
      const list = eventsByRun.get(e.runId) ?? []
      list.push({ kind: e.kind, data: e.data })
      eventsByRun.set(e.runId, list)
    }
    await syncRunDecisions(
      ctx.supabase,
      ctx.workspaceId,
      ctx.userId,
      runs
        .filter((r) => r.status === "awaiting_approval")
        .map((r) => ({ id: r.id, status: r.status, payload: r.payload })),
      eventsByRun,
    )
  } catch {
    // Linkage is additive; a failure here must not hide the existing cards.
  }

  const links = new Map<string, DecisionLinkRow>()
  if (runIds.length > 0) {
    const { data: decisionRows, error: decisionsError } = await ctx.supabase
      .from("decisions")
      .select("id, requested_by_run, artifact_hash, status, kind")
      .in("requested_by_run", runIds)
      .limit(100)
    if (!decisionsError) {
      for (const row of (decisionRows ?? []) as DecisionLinkRow[]) {
        if (row.requested_by_run) links.set(row.requested_by_run, row)
      }
    }
  }

  const projectIds = [...new Set(runs.map((r) => r.projectId).filter((x): x is string => !!x))]
  const projectNames: Record<string, string> = {}
  if (projectIds.length > 0) {
    const { data: projects } = await ctx.supabase.from("projects").select("id, name").in("id", projectIds)
    for (const p of (projects ?? []) as { id: string; name: string }[]) projectNames[p.id] = p.name
  }

  const cards = buildApprovalCards(
    runs,
    events.map((e) => ({ runId: e.runId, kind: e.kind, data: e.data, createdAt: e.createdAt })),
    conversationId,
    projectNames,
  ).map((card) => {
    const link = links.get(card.runId)
    return link
      ? {
          ...card,
          decisionId: link.id,
          artifactHash: link.artifact_hash,
          decisionStatus: link.status,
        }
      : card
  })

  return NextResponse.json({ cards })
}
