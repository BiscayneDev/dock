import { NextResponse } from "next/server"
import { assistantContext, isUuid } from "@/lib/assistant-store"
import { listEventsForRuns } from "@/lib/queue"
import { validateDecisionRequest, type DecisionKind, type DecisionOption } from "@/lib/decisions"
import {
  expireDueDecisions,
  insertDecision,
  listDecisions,
  syncRunDecisions,
  type VerdictRow,
} from "../decisions/store"

export const dynamic = "force-dynamic"

function verdictView(row: VerdictRow) {
  return {
    id: row.id,
    decisionId: row.decision_id,
    actorId: row.actor_id,
    verdict: row.verdict,
    status: row.status,
    artifactHash: row.artifact_hash,
    reason: row.reason,
    note: row.note,
    createdAt: row.created_at,
  }
}

/** GET /api/decisions — the ledger for one workspace. Owner session only. */
export async function GET(request: Request) {
  const ctx = await assistantContext()
  if (!ctx) return NextResponse.json({ error: "Sign in required" }, { status: 401 })

  const params = new URL(request.url).searchParams
  const status = params.get("status") ?? ""
  const kind = params.get("kind") ?? ""

  try {
    const now = Date.now()
    await expireDueDecisions(ctx.supabase, ctx.workspaceId, now)

    // Materialize pending approval decisions from runs before listing, so a run that parked itself
    // in awaiting_approval always has a ledger entry and a stable artifact hash.
    const { data: runs, error: runsError } = await ctx.supabase
      .from("task_runs")
      .select("id, status, payload")
      .eq("status", "awaiting_approval")
      .order("created_at", { ascending: false })
      .limit(100)
    if (runsError) throw new Error(runsError.message)
    const runRows = (runs ?? []) as Array<{ id: string; status: string; payload: Record<string, unknown> }>
    const events = await listEventsForRuns(
      ctx.supabase,
      runRows.map((r) => r.id),
    )
    const eventsByRun = new Map<string, Array<{ kind: string; data: Record<string, unknown> }>>()
    for (const e of events) {
      const list = eventsByRun.get(e.runId) ?? []
      list.push({ kind: e.kind, data: e.data })
      eventsByRun.set(e.runId, list)
    }
    await syncRunDecisions(ctx.supabase, ctx.workspaceId, ctx.userId, runRows, eventsByRun)

    const decisions = await listDecisions(ctx.supabase, ctx.workspaceId, {
      status: status || undefined,
      kind: kind || undefined,
    })
    return NextResponse.json({
      decisions: decisions.map((d) => ({
        ...d,
        verdicts: ((d as typeof d & { verdicts?: VerdictRow[] }).verdicts ?? []).map(verdictView),
      })),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load decisions"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

/**
 * POST /api/decisions — create a question, review or blocker card (agent callbacks and the inbox
 * UI use this). The artifact hash is computed server-side; a client cannot choose its own binding.
 */
export async function POST(request: Request) {
  const ctx = await assistantContext()
  if (!ctx) return NextResponse.json({ error: "Sign in required" }, { status: 401 })

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Malformed JSON body" }, { status: 400 })
  }

  const parsed = validateDecisionRequest(body)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
  const value = parsed.value
  if (value.requestedByRun && !isUuid(value.requestedByRun)) {
    return NextResponse.json({ error: "requestedByRun is not a valid run id" }, { status: 400 })
  }
  if (value.producerId && !isUuid(value.producerId)) {
    return NextResponse.json({ error: "producerId is not a valid user id" }, { status: 400 })
  }

  try {
    const decision = await insertDecision(ctx.supabase, {
      workspaceId: ctx.workspaceId,
      ownerId: ctx.userId,
      kind: value.kind as DecisionKind,
      title: value.title,
      summary: value.summary ?? "",
      artifactRef: value.artifactRef,
      artifactHash: value.artifactHash,
      requestedByRun: value.requestedByRun ?? null,
      producerId: value.producerId ?? null,
      options: value.options as DecisionOption[],
      reason: value.reason ?? null,
      expiresAt: value.expiresAt,
    })
    return NextResponse.json({ decision }, { status: 201 })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not create decision"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
