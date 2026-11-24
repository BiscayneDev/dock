import type { SupabaseClient } from "@supabase/supabase-js"
import { decideApproval, getRun, listEvents } from "@/lib/queue"
import {
  DECISION_DEFAULT_TTL_MS,
  artifactHash,
  decisionRefusal,
  isDecisionVerdict,
  reviewerIsProducer,
  runApprovalArtifact,
  runApprovalTitle,
  type DecisionKind,
  type DecisionOption,
  type DecisionRecord,
  type DecisionStatus,
  type DecisionVerdict,
} from "@/lib/decisions"

// Database wiring for the decision ledger. Pure rules live in lib/decisions.ts; this file owns the
// Supabase calls so the route handlers stay thin. Every call passes the caller's client: the owner's
// session for UI reads/writes (RLS applies), the service role for workers.

export interface DecisionRow {
  id: string
  workspace_id: string
  owner_id: string
  kind: string
  title: string
  summary: string
  artifact_ref: string
  artifact_hash: string
  requested_by_run: string | null
  options: unknown
  reason: string | null
  status: string
  decided_by: string | null
  decided_at: string | null
  expires_at: string | null
  snoozed_until: string | null
  producer_id: string | null
  created_at: string
  updated_at: string
}

export interface VerdictRow {
  id: string
  decision_id: string
  actor_id: string | null
  verdict: string
  status: string
  artifact_hash: string
  reason: string | null
  note: string | null
  created_at: string
}

export function decisionFromRow(row: DecisionRow): DecisionRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    ownerId: row.owner_id,
    kind: row.kind as DecisionKind,
    title: row.title,
    summary: row.summary,
    artifactRef: row.artifact_ref,
    artifactHash: row.artifact_hash,
    requestedByRun: row.requested_by_run,
    options: Array.isArray(row.options) ? (row.options as DecisionOption[]) : [],
    reason: row.reason,
    status: row.status as DecisionStatus,
    decidedBy: row.decided_by,
    decidedAt: row.decided_at,
    expiresAt: row.expires_at,
    snoozedUntil: row.snoozed_until,
    producerId: row.producer_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function optionsJson(options: DecisionOption[]): unknown {
  return options.map((o) => {
    const base: Record<string, unknown> = { id: o.id, label: o.label }
    if (o.description) base.description = o.description
    return base
  })
}

/** Lists decisions for one workspace, newest first. Attaches the audit trail by default. */
export async function listDecisions(
  client: SupabaseClient,
  workspaceId: string,
  opts: { status?: string; kind?: string; limit?: number; withVerdicts?: boolean } = {},
): Promise<DecisionRecord[]> {
  let query = client
    .from("decisions")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(Math.min(opts.limit ?? 200, 500))
  if (opts.status) query = query.eq("status", opts.status)
  if (opts.kind) query = query.eq("kind", opts.kind)
  const { data, error } = await query
  if (error) throw new Error(`decisions: ${error.message}`)
  const rows = (data ?? []) as DecisionRow[]
  const decisions = rows.map(decisionFromRow)
  if (opts.withVerdicts !== false && decisions.length > 0) {
    const { data: verdictRows, error: verdictError } = await client
      .from("decision_verdicts")
      .select("*")
      .in(
        "decision_id",
        decisions.map((d) => d.id),
      )
      .order("created_at", { ascending: true })
      .limit(1000)
    if (verdictError) throw new Error(`decision_verdicts: ${verdictError.message}`)
    const byDecision = new Map<string, VerdictRow[]>()
    for (const v of (verdictRows ?? []) as VerdictRow[]) {
      const list = byDecision.get(v.decision_id) ?? []
      list.push(v)
      byDecision.set(v.decision_id, list)
    }
    for (const d of decisions) {
      ;(d as DecisionRecord & { verdicts?: VerdictRow[] }).verdicts = byDecision.get(d.id) ?? []
    }
  }
  return decisions
}

export async function getDecision(client: SupabaseClient, id: string): Promise<DecisionRecord | null> {
  const { data, error } = await client.from("decisions").select("*").eq("id", id).maybeSingle()
  if (error) throw new Error(`decisions: ${error.message}`)
  return data ? decisionFromRow(data as DecisionRow) : null
}

export async function findPendingByRun(client: SupabaseClient, runId: string): Promise<DecisionRecord | null> {
  const { data, error } = await client
    .from("decisions")
    .select("*")
    .eq("requested_by_run", runId)
    .in("status", ["pending", "snoozed"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(`decisions: ${error.message}`)
  return data ? decisionFromRow(data as DecisionRow) : null
}

export async function insertDecision(
  client: SupabaseClient,
  input: {
    workspaceId: string
    ownerId: string
    kind: DecisionKind
    title: string
    summary: string
    artifactRef: string
    artifactHash: string
    requestedByRun: string | null
    producerId: string | null
    options: DecisionOption[]
    reason: string | null
    expiresAt: string | null
  },
): Promise<DecisionRecord> {
  const { data, error } = await client
    .from("decisions")
    .insert({
      workspace_id: input.workspaceId,
      owner_id: input.ownerId,
      kind: input.kind,
      title: input.title,
      summary: input.summary,
      artifact_ref: input.artifactRef,
      artifact_hash: input.artifactHash,
      requested_by_run: input.requestedByRun,
      producer_id: input.producerId,
      options: optionsJson(input.options),
      reason: input.reason,
      status: "pending",
      expires_at: input.expiresAt,
    })
    .select("*")
    .single()
  if (error) throw new Error(`decisions: ${error.message}`)
  return decisionFromRow(data as DecisionRow)
}

/**
 * Materializes one pending approval decision per awaiting_approval run that does not have one yet.
 * Existing decisions are never rewritten: their stored hash stays, so a later artifact change is
 * refused with "changed" instead of silently rebinding the card.
 */
export async function syncRunDecisions(
  client: SupabaseClient,
  workspaceId: string,
  ownerId: string,
  runs: Array<{ id: string; status: string; payload: Record<string, unknown> }>,
  eventsByRun: Map<string, Array<{ kind: string; data: Record<string, unknown> }>>,
): Promise<number> {
  const pending = runs.filter((r) => r.status === "awaiting_approval")
  if (pending.length === 0) return 0

  const existing = await listDecisions(client, workspaceId, { limit: 500, withVerdicts: false })
  const linkedRuns = new Set(existing.map((d) => d.requestedByRun).filter((x): x is string => !!x))

  let created = 0
  const now = Date.now()
  for (const run of pending) {
    if (linkedRuns.has(run.id)) continue
    const events = eventsByRun.get(run.id) ?? []
    const artifact = runApprovalArtifact({ payload: run.payload, events })
    if (!artifact) continue
    const actionId = String(artifact.actionId ?? "")
    const payload = run.payload ?? {}
    const producerId =
      (typeof payload.producerId === "string" && payload.producerId) ||
      (typeof payload.requestedByUserId === "string" && payload.requestedByUserId) ||
      null
    await insertDecision(client, {
      workspaceId,
      ownerId,
      kind: "approval",
      title: runApprovalTitle({ payload, events }),
      summary:
        (typeof payload.prompt === "string" && payload.prompt.slice(0, 2000)) ||
        (typeof artifact.description === "string" && artifact.description) ||
        "",
      artifactRef: `run:${run.id}${actionId ? `:${actionId}` : ""}`,
      artifactHash: artifactHash(artifact),
      requestedByRun: run.id,
      producerId,
      options: [
        { id: "approve", label: "Approve", description: "Let the run continue" },
        { id: "request_changes", label: "Request changes", description: "Send it back with a reason" },
      ],
      reason: null,
      expiresAt: new Date(now + DECISION_DEFAULT_TTL_MS).toISOString(),
    })
    created += 1
  }
  return created
}

export async function insertVerdict(
  client: SupabaseClient,
  input: {
    decisionId: string
    workspaceId: string
    actorId: string | null
    verdict: DecisionVerdict
    status: DecisionStatus
    artifactHash: string
    reason: string | null
    note: string | null
  },
): Promise<void> {
  const { error } = await client.from("decision_verdicts").insert({
    decision_id: input.decisionId,
    workspace_id: input.workspaceId,
    actor_id: input.actorId,
    verdict: input.verdict,
    status: input.status,
    artifact_hash: input.artifactHash,
    reason: input.reason,
    note: input.note,
  })
  if (error) throw new Error(`decision_verdicts: ${error.message}`)
}

export async function updateDecision(
  client: SupabaseClient,
  id: string,
  patch: Partial<Pick<DecisionRecord, "status" | "reason" | "decidedBy" | "decidedAt" | "snoozedUntil">>,
): Promise<void> {
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (patch.status !== undefined) row.status = patch.status
  if (patch.reason !== undefined) row.reason = patch.reason
  if (patch.decidedBy !== undefined) row.decided_by = patch.decidedBy
  if (patch.decidedAt !== undefined) row.decided_at = patch.decidedAt
  if (patch.snoozedUntil !== undefined) row.snoozed_until = patch.snoozedUntil
  const { error } = await client.from("decisions").update(row).eq("id", id)
  if (error) throw new Error(`decisions: ${error.message}`)
}

/** Marks pending decisions whose expiry has passed as expired. Returns how many moved. */
export async function expireDueDecisions(client: SupabaseClient, workspaceId: string, now: number): Promise<number> {
  const { data, error } = await client
    .from("decisions")
    .update({ status: "expired", updated_at: new Date(now).toISOString() })
    .eq("workspace_id", workspaceId)
    .eq("status", "pending")
    .lt("expires_at", new Date(now).toISOString())
    .select("id")
  if (error) throw new Error(`decisions: ${error.message}`)
  return Array.isArray(data) ? data.length : 0
}

export type RunVerdictResult =
  | { ok: true; decisionId: string | null; runStatus: string }
  | { ok: false; reason: string; httpStatus: number }

/**
 * Records an owner verdict on a run-backed approval through the decision ledger.
 *
 * Binding: the server recomputes the artifact hash from the live run payload + approval_requested
 * event and compares it with the hash stored when the card was materialized. A stale card (artifact
 * changed after the human opened it) is refused with "changed"; an already-decided or expired card
 * is refused with "not_pending"/"expired". The run itself still moves only through decideApproval,
 * so the money gate, its events and its budget rules are untouched.
 */
export async function recordRunVerdict(
  client: SupabaseClient,
  input: {
    userId: string
    runId: string
    decision: "approve" | "reject"
    reason?: string | null
    artifactHash?: string | null
  },
): Promise<RunVerdictResult> {
  const run = await getRun(client, input.runId)
  if (!run) return { ok: false, reason: "not_found", httpStatus: 404 }
  const events = await listEvents(client, input.runId)

  let currentHash: string | null = null
  const artifact = runApprovalArtifact({ payload: run.payload, events })
  if (artifact) currentHash = artifactHash(artifact)

  // Ensure a pending ledger row exists before comparing hashes; never rewrite an existing one.
  const eventsByRun = new Map<string, Array<{ kind: string; data: Record<string, unknown> }>>()
  eventsByRun.set(run.id, events.map((e) => ({ kind: e.kind, data: e.data })))
  await syncRunDecisions(
    client,
    run.workspaceId,
    run.ownerId,
    [{ id: run.id, status: run.status, payload: run.payload }],
    eventsByRun,
  )

  const decision = await findPendingByRun(client, input.runId)
  if (decision && reviewerIsProducer(input.userId, decision.producerId)) {
    return { ok: false, reason: "reviewer_is_producer", httpStatus: 409 }
  }
  const now = Date.now()
  if (decision) {
    const refusal = decisionRefusal({
      status: decision.status,
      expiresAt: decision.expiresAt,
      now,
      storedHash: decision.artifactHash,
      expectedHash: input.artifactHash ?? currentHash,
      currentHash,
    })
    if (refusal) {
      return {
        ok: false,
        reason: refusal,
        httpStatus: refusal === "expired" ? 410 : 409,
      }
    }
  }

  const result = await decideApproval(client, input.runId, input.decision, input.userId)
  if (!result.ok) {
    return {
      ok: false,
      reason: result.reason,
      httpStatus: result.reason === "not_found" ? 404 : 409,
    }
  }

  const verdict: DecisionVerdict = input.decision === "approve" ? "approve" : "request_changes"
  if (!isDecisionVerdict(verdict)) return { ok: false, reason: "invalid_verdict", httpStatus: 400 }

  const reason = input.reason?.trim() || (input.decision === "reject" ? "Rejected by owner" : null)
  const decidedAt = new Date(now).toISOString()
  if (decision) {
    await insertVerdict(client, {
      decisionId: decision.id,
      workspaceId: decision.workspaceId,
      actorId: input.userId,
      verdict,
      status: input.decision === "approve" ? "approved" : "changes_requested",
      artifactHash: input.artifactHash ?? currentHash ?? decision.artifactHash,
      reason,
      note: null,
    })
    await updateDecision(client, decision.id, {
      status: input.decision === "approve" ? "approved" : "changes_requested",
      decidedBy: input.userId,
      decidedAt,
    })
  }

  return { ok: true, decisionId: decision?.id ?? null, runStatus: result.run.status }
}
