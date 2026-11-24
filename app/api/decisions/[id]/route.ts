import { NextResponse } from "next/server"
import { assistantContext, isUuid } from "@/lib/assistant-store"
import { decideApproval, getRun, listEvents } from "@/lib/queue"
import {
  artifactHash,
  decisionRefusal,
  isExpired,
  planVerdict,
  reviewerIsProducer,
  runApprovalArtifact,
} from "@/lib/decisions"
import { getDecision, insertVerdict, updateDecision } from "../store"

export const dynamic = "force-dynamic"

interface Context {
  params: Promise<{ id: string }>
}

/** GET /api/decisions/:id — one card plus its append-only audit trail. Owner session only. */
export async function GET(_: Request, context: Context) {
  const ctx = await assistantContext()
  if (!ctx) return NextResponse.json({ error: "Sign in required" }, { status: 401 })
  const { id } = await context.params
  if (!isUuid(id)) return NextResponse.json({ error: "Decision not found" }, { status: 404 })

  const decision = await getDecision(ctx.supabase, id)
  if (!decision) return NextResponse.json({ error: "Decision not found" }, { status: 404 })
  if (decision.status === "pending" && isExpired(decision.expiresAt, Date.now())) {
    await updateDecision(ctx.supabase, decision.id, { status: "expired" })
    decision.status = "expired"
    decision.updatedAt = new Date().toISOString()
  }

  const { data: verdictRows, error } = await ctx.supabase
    .from("decision_verdicts")
    .select("*")
    .eq("decision_id", decision.id)
    .order("created_at", { ascending: true })
    .limit(200)
  if (error) return NextResponse.json({ error: "Could not load audit trail" }, { status: 500 })

  return NextResponse.json({
    decision,
    verdicts: (verdictRows ?? []).map((v) => {
      const row = v as Record<string, unknown>
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
    }),
  })
}

/**
 * PATCH /api/decisions/:id — record a verdict. The body must carry the artifact hash the reviewer saw;
 * for run-backed cards the server recomputes the hash from the live run and refuses any stale card.
 * A reason is mandatory for request_changes. Run-backed approvals go through decideApproval, so the
 * money gate, its events and its budget rules are unchanged.
 */
export async function PATCH(request: Request, context: Context) {
  const ctx = await assistantContext()
  if (!ctx) return NextResponse.json({ error: "Sign in required" }, { status: 401 })
  const { id } = await context.params
  if (!isUuid(id)) return NextResponse.json({ error: "Decision not found" }, { status: 404 })

  let body: Record<string, unknown>
  try {
    const parsed: unknown = await request.json()
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("bad body")
    body = parsed as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: "Malformed JSON body" }, { status: 400 })
  }

  const decision = await getDecision(ctx.supabase, id)
  if (!decision) return NextResponse.json({ error: "Decision not found" }, { status: 404 })

  if (reviewerIsProducer(ctx.userId, decision.producerId)) {
    return NextResponse.json(
      { error: "reviewer_is_producer", message: "The producer of a run cannot approve its own work." },
      { status: 409 },
    )
  }

  const plan = planVerdict({ verdict: body.verdict, kind: decision.kind, reason: body.reason, note: body.note })
  if (!plan.ok) return NextResponse.json({ error: plan.error }, { status: 400 })

  // Current artifact for run-backed cards. A changed run means the card is stale.
  let currentHash: string | null = null
  if (decision.requestedByRun) {
    const run = await getRun(ctx.supabase, decision.requestedByRun)
    if (run) {
      const events = await listEvents(ctx.supabase, decision.requestedByRun)
      const artifact = runApprovalArtifact({ payload: run.payload, events })
      if (artifact) currentHash = artifactHash(artifact)
    }
  }
  const now = Date.now()
  const clientHash = typeof body.artifactHash === "string" && body.artifactHash ? body.artifactHash : null
  const refusal = decisionRefusal({
    status: decision.status,
    expiresAt: decision.expiresAt,
    now,
    storedHash: decision.artifactHash,
    expectedHash: clientHash ?? currentHash,
    currentHash,
  })
  if (refusal) {
    const status = refusal === "not_pending" ? 409 : refusal === "expired" ? 410 : 409
    return NextResponse.json({ error: refusal }, { status })
  }

  const runId = decision.requestedByRun
  if (runId && (plan.status === "approved" || plan.status === "edited_accepted")) {
    const result = await decideApproval(ctx.supabase, runId, "approve", ctx.userId)
    if (!result.ok) return NextResponse.json({ error: result.reason }, { status: 409 })
  } else if (runId && plan.status === "changes_requested") {
    const result = await decideApproval(ctx.supabase, runId, "reject", ctx.userId)
    if (!result.ok) return NextResponse.json({ error: result.reason }, { status: 409 })
  }

  let snoozedUntil: string | null = null
  if (plan.status === "snoozed") {
    const raw = body.snoozeUntil
    const parsed = typeof raw === "string" && raw.trim() ? Date.parse(raw) : NaN
    snoozedUntil = Number.isFinite(parsed) ? new Date(parsed).toISOString() : new Date(now + 24 * 60 * 60 * 1000).toISOString()
  }

  const decidedAt = new Date(now).toISOString()
  await insertVerdict(ctx.supabase, {
    decisionId: decision.id,
    workspaceId: decision.workspaceId,
    actorId: ctx.userId,
    verdict: plan.verdict,
    status: plan.status,
    artifactHash: clientHash ?? currentHash ?? decision.artifactHash,
    reason: plan.reason,
    note: plan.note,
  })
  await updateDecision(ctx.supabase, decision.id, {
    status: plan.status,
    decidedBy: ctx.userId,
    decidedAt,
    snoozedUntil,
  })

  const updated = await getDecision(ctx.supabase, decision.id)
  return NextResponse.json({ decision: updated })
}
