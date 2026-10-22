import type { SupabaseClient } from "@supabase/supabase-js"
import { EVENT, RUN_TARGETS, type ProposedAction, type RunStatus, type RunTarget } from "@/lib/task-runs"

// Task queue data layer (migration 0005). Owner calls pass the signed-in session client (RLS applies).
// Worker calls pass the service-role client: they claim, heartbeat and complete runs for any workspace.

export interface TaskRun {
  id: string
  workspaceId: string
  ownerId: string
  projectId: string | null
  agentId: string | null
  agentKey: string
  target: RunTarget
  status: RunStatus
  payload: Record<string, unknown>
  model: string | null
  budgetCents: number
  spentCents: number
  leaseOwner: string | null
  leaseUntil: string | null
  attempts: number
  maxAttempts: number
  error: string | null
  output: string | null
  createdAt: string
  updatedAt: string
  startedAt: string | null
  finishedAt: string | null
}

export interface RunEvent {
  id: string
  runId: string
  kind: string
  data: Record<string, unknown>
  createdAt: string
}

export const DEFAULT_LEASE_SECONDS = 180

function fromRow(r: Record<string, unknown>): TaskRun {
  return {
    id: r.id as string,
    workspaceId: r.workspace_id as string,
    ownerId: r.owner_id as string,
    projectId: (r.project_id as string | null) ?? null,
    agentId: (r.agent_id as string | null) ?? null,
    agentKey: r.agent_key as string,
    target: r.target as RunTarget,
    status: r.status as RunStatus,
    payload: (r.payload as Record<string, unknown>) ?? {},
    model: (r.model as string | null) ?? null,
    budgetCents: r.budget_cents as number,
    spentCents: r.spent_cents as number,
    leaseOwner: (r.lease_owner as string | null) ?? null,
    leaseUntil: (r.lease_until as string | null) ?? null,
    attempts: r.attempts as number,
    maxAttempts: r.max_attempts as number,
    error: (r.error as string | null) ?? null,
    output: (r.output as string | null) ?? null,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
    startedAt: (r.started_at as string | null) ?? null,
    finishedAt: (r.finished_at as string | null) ?? null,
  }
}

function eventFromRow(r: Record<string, unknown>): RunEvent {
  return {
    id: r.id as string,
    runId: r.run_id as string,
    kind: r.kind as string,
    data: (r.data as Record<string, unknown>) ?? {},
    createdAt: r.created_at as string,
  }
}

export interface EnqueueInput {
  workspaceId: string
  ownerId: string
  projectId: string | null
  agentId: string | null
  agentKey: string
  target: RunTarget
  prompt: string
  model: string | null
  budgetCents: number
  proposedAction?: ProposedAction | null
  /** Set when the run was approved from a project brief. The worker uses it to write the outcome back. */
  briefId?: string | null
}

/** Owner-side insert. RLS requires owner_id = auth.uid() and a workspace the user owns. */
export async function enqueueRun(supabase: SupabaseClient, input: EnqueueInput): Promise<TaskRun> {
  if (!(RUN_TARGETS as readonly string[]).includes(input.target)) throw new Error("invalid target")
  const payload: Record<string, unknown> = { prompt: input.prompt }
  if (input.proposedAction) payload.proposedAction = input.proposedAction
  if (input.briefId) payload.briefId = input.briefId
  const { data, error } = await supabase
    .from("task_runs")
    .insert({
      workspace_id: input.workspaceId,
      owner_id: input.ownerId,
      project_id: input.projectId,
      agent_id: input.agentId,
      agent_key: input.agentKey,
      target: input.target,
      status: "queued",
      payload,
      model: input.model,
      budget_cents: input.budgetCents,
    })
    .select("*")
    .single()
  if (error || !data) throw new Error(`enqueue: ${error?.message ?? "insert failed"}`)
  await addEvent(supabase, (data as Record<string, unknown>).id as string, "queued", { target: input.target })
  return fromRow(data as Record<string, unknown>)
}

/** Lease the oldest queued run. Expired leases are recovered inside the same call. Null when nothing is queued. */
export async function claimNext(
  admin: SupabaseClient,
  workerId: string,
  leaseSeconds: number = DEFAULT_LEASE_SECONDS,
): Promise<TaskRun | null> {
  const { data, error } = await admin.rpc("claim_task_run", { p_worker: workerId, p_lease_seconds: leaseSeconds })
  if (error) throw new Error(`claim: ${error.message}`)
  const rows = (data ?? []) as Record<string, unknown>[]
  return rows.length > 0 ? fromRow(rows[0]) : null
}

/** Extend the lease. False when this worker no longer holds the run (lease expired and was taken over). */
export async function heartbeat(
  admin: SupabaseClient,
  runId: string,
  workerId: string,
  leaseSeconds: number = DEFAULT_LEASE_SECONDS,
): Promise<boolean> {
  const until = new Date(Date.now() + leaseSeconds * 1000).toISOString()
  const { data, error } = await admin
    .from("task_runs")
    .update({ lease_until: until, updated_at: new Date().toISOString() })
    .eq("id", runId)
    .eq("lease_owner", workerId)
    .in("status", ["leased", "running"])
    .select("id")
  if (error) throw new Error(`heartbeat: ${error.message}`)
  return (data ?? []).length === 1
}

export async function markRunning(admin: SupabaseClient, runId: string, workerId: string): Promise<boolean> {
  const { data, error } = await admin
    .from("task_runs")
    .update({ status: "running", updated_at: new Date().toISOString() })
    .eq("id", runId)
    .eq("lease_owner", workerId)
    .eq("status", "leased")
    .select("id")
  if (error) throw new Error(`running: ${error.message}`)
  return (data ?? []).length === 1
}

/** Parks a run until an owner decides on a money action. Clears the lease so no worker holds it. */
export async function parkForApproval(admin: SupabaseClient, runId: string, workerId: string): Promise<boolean> {
  const { data, error } = await admin
    .from("task_runs")
    .update({ status: "awaiting_approval", lease_owner: null, lease_until: null, updated_at: new Date().toISOString() })
    .eq("id", runId)
    .eq("lease_owner", workerId)
    .in("status", ["leased", "running"])
    .select("id")
  if (error) throw new Error(`park: ${error.message}`)
  return (data ?? []).length === 1
}

/** Adds spend to the run. Only the current leaseholder can meter it. */
export async function addSpend(admin: SupabaseClient, run: TaskRun, workerId: string, cents: number): Promise<number> {
  if (cents <= 0) return run.spentCents
  const next = run.spentCents + cents
  const { data, error } = await admin
    .from("task_runs")
    .update({ spent_cents: next, updated_at: new Date().toISOString() })
    .eq("id", run.id)
    .eq("lease_owner", workerId)
    .select("spent_cents")
  if (error) throw new Error(`spend: ${error.message}`)
  if ((data ?? []).length !== 1) throw new Error("spend: lease lost")
  return next
}

export async function complete(
  admin: SupabaseClient,
  runId: string,
  workerId: string,
  result: { status: "succeeded" | "failed" | "cancelled"; output?: string | null; error?: string | null },
): Promise<boolean> {
  const now = new Date().toISOString()
  const { data, error } = await admin
    .from("task_runs")
    .update({
      status: result.status,
      output: result.output ?? null,
      error: result.error ?? null,
      lease_owner: null,
      lease_until: null,
      finished_at: now,
      updated_at: now,
    })
    .eq("id", runId)
    .eq("lease_owner", workerId)
    .in("status", ["leased", "running"])
    .select("id")
  if (error) throw new Error(`complete: ${error.message}`)
  const kind = result.status === "succeeded" ? EVENT.completed : result.status === "failed" ? EVENT.failed : EVENT.cancelled
  await addEvent(admin, runId, kind, result.error ? { error: result.error } : {})
  return (data ?? []).length === 1
}

export async function addEvent(
  client: SupabaseClient,
  runId: string,
  kind: string,
  data: Record<string, unknown> = {},
): Promise<void> {
  const { error } = await client.from("task_run_events").insert({ run_id: runId, kind, data })
  if (error) throw new Error(`event ${kind}: ${error.message}`)
}

export async function getRun(client: SupabaseClient, runId: string): Promise<TaskRun | null> {
  const { data, error } = await client.from("task_runs").select("*").eq("id", runId).maybeSingle()
  if (error) throw new Error(`run: ${error.message}`)
  return data ? fromRow(data as Record<string, unknown>) : null
}

export async function listEvents(client: SupabaseClient, runId: string): Promise<RunEvent[]> {
  const { data, error } = await client
    .from("task_run_events")
    .select("*")
    .eq("run_id", runId)
    .order("created_at", { ascending: true })
    .limit(500)
  if (error) throw new Error(`events: ${error.message}`)
  return (data ?? []).map((r) => eventFromRow(r as Record<string, unknown>))
}

export async function listRuns(client: SupabaseClient, limit = 50): Promise<TaskRun[]> {
  const { data, error } = await client
    .from("task_runs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit)
  if (error) throw new Error(`runs: ${error.message}`)
  return (data ?? []).map((r) => fromRow(r as Record<string, unknown>))
}

/**
 * Owner decision on a parked money action. Runs with the owner's session (RLS), so only the owner can decide.
 * Approve re-queues the run; the worker then executes the approved action. Reject cancels the run.
 */
export async function decideApproval(
  supabase: SupabaseClient,
  runId: string,
  decision: "approve" | "reject",
): Promise<{ ok: true; run: TaskRun } | { ok: false; reason: string }> {
  const run = await getRun(supabase, runId)
  if (!run) return { ok: false, reason: "not_found" }
  if (run.status !== "awaiting_approval") return { ok: false, reason: "not_awaiting_approval" }
  const events = await listEvents(supabase, runId)
  const requested = [...events].reverse().find((e) => e.kind === EVENT.approvalRequested)
  if (!requested) return { ok: false, reason: "no_pending_action" }
  const actionId = requested.data.actionId
  const decided = events.some(
    (e) => (e.kind === EVENT.approvalGranted || e.kind === EVENT.approvalRejected) && e.data.actionId === actionId,
  )
  if (decided) return { ok: false, reason: "already_decided" }

  const now = new Date().toISOString()
  if (decision === "approve") {
    await addEvent(supabase, runId, EVENT.approvalGranted, { actionId, amountCents: requested.data.amountCents })
    const { data, error } = await supabase
      .from("task_runs")
      .update({ status: "queued", updated_at: now })
      .eq("id", runId)
      .eq("status", "awaiting_approval")
      .select("*")
    if (error || !data || data.length !== 1) return { ok: false, reason: "state_changed" }
    return { ok: true, run: fromRow(data[0] as Record<string, unknown>) }
  }
  await addEvent(supabase, runId, EVENT.approvalRejected, { actionId })
  const { data, error } = await supabase
    .from("task_runs")
    .update({ status: "cancelled", error: "rejected by owner", finished_at: now, updated_at: now })
    .eq("id", runId)
    .eq("status", "awaiting_approval")
    .select("*")
  if (error || !data || data.length !== 1) return { ok: false, reason: "state_changed" }
  await addEvent(supabase, runId, EVENT.cancelled, { reason: "rejected by owner" })
  return { ok: true, run: fromRow(data[0] as Record<string, unknown>) }
}

/** Events for several runs in one query, oldest first. */
export async function listEventsForRuns(client: SupabaseClient, runIds: string[]): Promise<RunEvent[]> {
  if (runIds.length === 0) return []
  const { data, error } = await client
    .from("task_run_events")
    .select("*")
    .in("run_id", runIds)
    .order("created_at", { ascending: true })
    .limit(2000)
  if (error) throw new Error(`events: ${error.message}`)
  return (data ?? []).map((r) => eventFromRow(r as Record<string, unknown>))
}
