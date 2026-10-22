import type { SupabaseClient } from "@supabase/supabase-js"
import { enqueueRun, type TaskRun } from "@/lib/queue"
import { resolveAgentExplore } from "@/lib/agent-flags"
import { resolveModelRef } from "@/lib/inference"
import {
  canApprove,
  canCancel,
  checkMonthlyCap,
  monthStartIso,
  pickChief,
  type RosterEntry,
  composeRunPrompt,
  outcomeForRun,
  type Assignment,
  assignmentRunPrompt,
  type BriefProposal,
  type BriefState,
  type LedgerKind,
  type RiskFlag,
} from "@/lib/briefs"

// Briefs and the ledger (central thread v1). Every write runs under the caller's client: the owner's session for
// user actions (RLS), the service role for the worker's outcome hook. Approval is the only path that creates a run.

export interface Brief {
  id: string
  workspaceId: string
  ownerId: string
  projectId: string | null
  conversationId: string | null
  runId: string | null
  agentKey: string
  goal: string
  context: string
  deliverables: string[]
  budgetCents: number
  assignments: Assignment[]
  riskFlags: RiskFlag[]
  state: BriefState
  outputSummary: string
  error: string | null
  createdAt: string
  updatedAt: string
  decidedAt: string | null
  finishedAt: string | null
}

export interface LedgerEntry {
  id: string
  projectId: string | null
  briefId: string | null
  runId: string | null
  kind: LedgerKind
  agentKey: string
  summary: string
  costCents: number | null
  createdAt: string
}

const BRIEF_COLS =
  "id, workspace_id, owner_id, project_id, conversation_id, run_id, agent_key, goal, context, deliverables, budget_cents, assignments, risk_flags, state, output_summary, error, created_at, updated_at, decided_at, finished_at"

type Row = Record<string, unknown>

function toBrief(r: Row): Brief {
  return {
    id: r.id as string,
    workspaceId: r.workspace_id as string,
    ownerId: r.owner_id as string,
    projectId: (r.project_id as string | null) ?? null,
    conversationId: (r.conversation_id as string | null) ?? null,
    runId: (r.run_id as string | null) ?? null,
    agentKey: r.agent_key as string,
    goal: r.goal as string,
    context: (r.context as string) ?? "",
    deliverables: (r.deliverables as string[]) ?? [],
    budgetCents: r.budget_cents as number,
    assignments: ((r.assignments as Assignment[]) ?? []) as Assignment[],
    riskFlags: ((r.risk_flags as RiskFlag[]) ?? []) as RiskFlag[],
    state: r.state as BriefState,
    outputSummary: (r.output_summary as string) ?? "",
    error: (r.error as string | null) ?? null,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
    decidedAt: (r.decided_at as string | null) ?? null,
    finishedAt: (r.finished_at as string | null) ?? null,
  }
}

function toLedger(r: Row): LedgerEntry {
  return {
    id: r.id as string,
    projectId: (r.project_id as string | null) ?? null,
    briefId: (r.brief_id as string | null) ?? null,
    runId: (r.run_id as string | null) ?? null,
    kind: r.kind as LedgerKind,
    agentKey: r.agent_key as string,
    summary: r.summary as string,
    costCents: (r.cost_cents as number | null) ?? null,
    createdAt: r.created_at as string,
  }
}

export interface Scope {
  workspaceId: string
  ownerId: string
}

async function writeLedger(
  client: SupabaseClient,
  scope: Scope,
  entry: { projectId: string | null; briefId: string | null; runId: string | null; kind: LedgerKind; agentKey: string; summary: string; costCents?: number | null },
): Promise<void> {
  const { error } = await client.from("ledger_entries").insert({
    workspace_id: scope.workspaceId,
    owner_id: scope.ownerId,
    project_id: entry.projectId,
    brief_id: entry.briefId,
    run_id: entry.runId,
    kind: entry.kind,
    agent_key: entry.agentKey,
    summary: entry.summary.slice(0, 500),
    cost_cents: entry.costCents ?? null,
  })
  if (error) throw new Error(`ledger: ${error.message}`)
}

/**
 * The one central conversation for a project. Find it or create it. The project's name is its title.
 * Legacy multi-thread rows are left alone; new work always lands in the central thread.
 */
export async function ensureCentralConversation(
  client: SupabaseClient,
  scope: Scope,
  projectId: string,
  agentKey: string,
): Promise<{ id: string }> {
  const { data: existing, error: findError } = await client
    .from("conversations")
    .select("id")
    .eq("workspace_id", scope.workspaceId)
    .eq("project_id", projectId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle()
  if (findError) throw new Error(`conversations: ${findError.message}`)
  if (existing) return { id: existing.id as string }

  const { data: project } = await client.from("projects").select("name").eq("id", projectId).maybeSingle()
  const { data, error } = await client
    .from("conversations")
    .insert({
      workspace_id: scope.workspaceId,
      owner_id: scope.ownerId,
      project_id: projectId,
      title: ((project?.name as string | undefined) ?? "Project").slice(0, 200),
      agent: agentKey,
    })
    .select("id")
    .single()
  if (error || !data) throw new Error(`conversations: ${error?.message ?? "insert failed"}`)
  return { id: data.id as string }
}

/** Stores proposals from one assistant reply. Each becomes a `proposed` brief plus a ledger line. */
export async function createBriefs(
  client: SupabaseClient,
  scope: Scope,
  input: { projectId: string; conversationId: string; proposals: BriefProposal[]; defaultAgentKey: string },
): Promise<Brief[]> {
  const out: Brief[] = []
  for (const p of input.proposals) {
    const { data, error } = await client
      .from("project_briefs")
      .insert({
        workspace_id: scope.workspaceId,
        owner_id: scope.ownerId,
        project_id: input.projectId,
        conversation_id: input.conversationId,
        agent_key: p.assignments[0]?.agentKey ?? p.agentKey ?? input.defaultAgentKey,
        goal: p.goal,
        context: p.context,
        deliverables: p.deliverables,
        assignments: p.assignments.map((a) => ({ agentKey: a.agentKey ?? p.agentKey ?? input.defaultAgentKey, prompt: a.prompt, skills: a.skills })),
        budget_cents: p.budgetCents,
        risk_flags: p.riskFlags,
        state: "proposed",
      })
      .select(BRIEF_COLS)
      .single()
    if (error || !data) throw new Error(`briefs: ${error?.message ?? "insert failed"}`)
    const brief = toBrief(data as unknown as Row)
    await writeLedger(client, scope, {
      projectId: input.projectId,
      briefId: brief.id,
      runId: null,
      kind: "brief_proposed",
      agentKey: brief.agentKey,
      summary: brief.goal,
    })
    out.push(brief)
  }
  return out
}

export async function getBrief(client: SupabaseClient, id: string): Promise<Brief | null> {
  const { data, error } = await client.from("project_briefs").select(BRIEF_COLS).eq("id", id).maybeSingle()
  if (error) throw new Error(`briefs: ${error.message}`)
  return data ? toBrief(data as unknown as Row) : null
}

export async function listBriefsForProject(client: SupabaseClient, projectId: string, limit = 50): Promise<Brief[]> {
  const { data, error } = await client
    .from("project_briefs")
    .select(BRIEF_COLS)
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(limit)
  if (error) throw new Error(`briefs: ${error.message}`)
  return ((data ?? []) as unknown as Row[]).map(toBrief)
}

export async function listLedger(client: SupabaseClient, projectId: string, limit = 100): Promise<LedgerEntry[]> {
  const { data, error } = await client
    .from("ledger_entries")
    .select("id, project_id, brief_id, run_id, kind, agent_key, summary, cost_cents, created_at")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(limit)
  if (error) throw new Error(`ledger: ${error.message}`)
  return ((data ?? []) as unknown as Row[]).map(toLedger)
}

export class BriefConflictError extends Error {}
export class CapExceededError extends Error {}

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`

export interface ProjectSpend {
  capCents: number | null
  /** Cost of finished runs this month (ledger). */
  spentCents: number
  /** Budgets of approved and running briefs this month. */
  reservedCents: number
  periodStart: string
}

/** Cap, spend and reservations for one project in the current UTC month. */
export async function getProjectSpend(client: SupabaseClient, projectId: string, now: Date): Promise<ProjectSpend> {
  const periodStart = monthStartIso(now)
  const { data: project, error: projectError } = await client
    .from("projects")
    .select("monthly_spend_cap_cents")
    .eq("id", projectId)
    .maybeSingle()
  if (projectError) throw new Error(`projects: ${projectError.message}`)
  const capCents = (project?.monthly_spend_cap_cents as number | null | undefined) ?? null

  const { data: spendRows, error: spendError } = await client
    .from("ledger_entries")
    .select("cost_cents")
    .eq("project_id", projectId)
    .in("kind", ["run_succeeded", "run_failed"])
    .gte("created_at", periodStart)
  if (spendError) throw new Error(`ledger: ${spendError.message}`)
  const spentCents = ((spendRows ?? []) as Array<{ cost_cents: number | null }>).reduce((t, r) => t + (r.cost_cents ?? 0), 0)

  const { data: reservedRows, error: reservedError } = await client
    .from("project_briefs")
    .select("budget_cents")
    .eq("project_id", projectId)
    .in("state", ["approved", "running"])
  if (reservedError) throw new Error(`briefs: ${reservedError.message}`)
  const reservedCents = ((reservedRows ?? []) as Array<{ budget_cents: number }>).reduce((t, r) => t + r.budget_cents, 0)

  return { capCents, spentCents, reservedCents, periodStart }
}

/** Owner sets or clears the monthly cap. Caller validates the value first (validateCapCents). */
export async function setProjectCap(client: SupabaseClient, projectId: string, capCents: number | null): Promise<void> {
  const { data, error } = await client
    .from("projects")
    .update({ monthly_spend_cap_cents: capCents })
    .eq("id", projectId)
    .select("id")
  if (error) throw new Error(`projects: ${error.message}`)
  if (!data || data.length === 0) throw new Error("not_found")
}

/**
 * Owner approves a brief. The state flip is a conditional update (proposed -> approved), so a double click
 * cannot create two runs. Then the run is queued with the brief's budget. If queueing fails, the brief goes back to proposed.
 */
export async function approveBrief(
  client: SupabaseClient,
  scope: Scope,
  briefId: string,
  maxBudgetCents: number,
): Promise<{ brief: Brief; runs: TaskRun[] }> {
  const current = await getBrief(client, briefId)
  if (!current) throw new Error("not_found")
  if (!canApprove(current.state)) throw new BriefConflictError(`brief is ${current.state}`)

  const { data: claimed, error: claimError } = await client
    .from("project_briefs")
    .update({ state: "approved", decided_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", briefId)
    .eq("state", "proposed")
    .select("id")
  if (claimError) throw new Error(`briefs: ${claimError.message}`)
  if (!claimed || claimed.length === 0) throw new BriefConflictError("brief was already decided")

  // Monthly cap. Checked after the flip, so this brief's own budget is already in the reserved total.
  // Two approvals racing each see each other as approved, so the race can only over-refuse, never over-spend.
  if (current.projectId) {
    const spend = await getProjectSpend(client, current.projectId, new Date())
    const check = checkMonthlyCap({ capCents: spend.capCents, spentCents: spend.spentCents, reservedCents: spend.reservedCents })
    if (!check.ok) {
      await client.from("project_briefs").update({ state: "proposed", decided_at: null }).eq("id", briefId)
      throw new CapExceededError(
        `Monthly cap of ${money(check.capCents ?? 0)} would be exceeded: ${money(spend.spentCents)} spent and ${money(spend.reservedCents)} reserved this month.`,
      )
    }
  }

  // One run per assignment. Each gets an equal share of the brief's budget, so the total never exceeds the cap.
  const total = Math.min(current.budgetCents, maxBudgetCents)
  const assignments = current.assignments.length > 0 ? current.assignments : [{ agentKey: current.agentKey, prompt: composeRunPrompt({ goal: current.goal, context: current.context, deliverables: current.deliverables, budgetCents: total, riskFlags: current.riskFlags }), skills: [] }]
  const share = Math.max(1, Math.floor(total / assignments.length))
  const runs: TaskRun[] = []
  try {
    for (const a of assignments) {
      const agentKey = a.agentKey ?? current.agentKey
      const model = resolveModelRef(agentKey)
      if (!model) throw new Error(`No model configured for ${agentKey}`)
      runs.push(
        await enqueueRun(client, {
          workspaceId: scope.workspaceId,
          ownerId: scope.ownerId,
          projectId: current.projectId,
          agentId: null,
          agentKey,
          target: "cloud",
          prompt: assignmentRunPrompt(a, share, current.riskFlags),
          model,
          budgetCents: share,
          briefId: current.id,
          explore: await resolveAgentExplore(agentKey),
        }),
      )
    }
  } catch (error) {
    // Partial failure: cancel what was queued, put the brief back to proposed, and surface the error.
    if (runs.length > 0) {
      await client
        .from("task_runs")
        .update({ status: "cancelled", error: "task approval did not complete", finished_at: new Date().toISOString() })
        .in("id", runs.map((r) => r.id))
        .eq("status", "queued")
    }
    await client.from("project_briefs").update({ state: "proposed", decided_at: null }).eq("id", briefId)
    throw error
  }

  const { data: updated, error: linkError } = await client
    .from("project_briefs")
    .update({ state: "running", run_id: runs[0].id, updated_at: new Date().toISOString() })
    .eq("id", briefId)
    .select(BRIEF_COLS)
    .single()
  if (linkError || !updated) throw new Error(`briefs: ${linkError?.message ?? "link failed"}`)

  for (const run of runs) {
    await writeLedger(client, scope, {
      projectId: current.projectId,
      briefId: current.id,
      runId: run.id,
      kind: "run_started",
      agentKey: run.agentKey,
      summary: `Delegated: ${current.goal}`,
    })
  }
  return { brief: toBrief(updated as unknown as Row), runs }
}

export async function cancelBrief(client: SupabaseClient, scope: Scope, briefId: string): Promise<Brief> {
  const current = await getBrief(client, briefId)
  if (!current) throw new Error("not_found")
  if (!canCancel(current.state)) throw new BriefConflictError(`brief is ${current.state}`)
  const { data, error } = await client
    .from("project_briefs")
    .update({ state: "cancelled", decided_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", briefId)
    .eq("state", "proposed")
    .select(BRIEF_COLS)
    .maybeSingle()
  if (error) throw new Error(`briefs: ${error.message}`)
  if (!data) throw new BriefConflictError("brief was already decided")
  await writeLedger(client, scope, {
    projectId: current.projectId,
    briefId: current.id,
    runId: null,
    kind: "brief_cancelled",
    agentKey: current.agentKey,
    summary: current.goal,
  })
  return toBrief(data as unknown as Row)
}

/**
 * Called by the worker when a brief-linked run finishes. Updates the brief, writes the ledger line, and posts the
 * result into the central thread so the work shows up where the conversation is. Service-role client only.
 */
export async function recordRunOutcome(
  admin: SupabaseClient,
  run: { id: string; workspaceId: string; ownerId: string; projectId: string | null; agentKey: string; spentCents: number },
  briefId: string,
  status: "succeeded" | "failed" | "cancelled",
  detail: { output?: string | null; error?: string | null },
): Promise<void> {
  const brief = await getBrief(admin, briefId)
  if (!brief) return
  const { ledgerKind } = outcomeForRun(status)
  const summary = (detail.output ?? "").trim().slice(0, 2000)
  const scope = { workspaceId: run.workspaceId, ownerId: run.ownerId }

  // This subagent's outcome: its own ledger line and its own result message in the thread.
  await writeLedger(admin, scope, {
    projectId: run.projectId,
    briefId,
    runId: run.id,
    kind: ledgerKind,
    agentKey: run.agentKey,
    summary:
      status === "succeeded"
        ? summary.split("\n")[0] || brief.goal
        : `${brief.goal}: ${detail.error ?? status}`,
    costCents: run.spentCents,
  })
  if (brief.conversationId) {
    const content = status === "succeeded" ? summary || "Finished with no output." : `The run stopped: ${detail.error ?? status}.`
    await admin.from("messages").insert({
      conversation_id: brief.conversationId,
      role: "agent",
      content,
      agent: run.agentKey,
      meta: { kind: "result", briefId, runId: run.id },
    })
    await admin.from("conversations").update({ updated_at: new Date().toISOString() }).eq("id", brief.conversationId)
  }

  // The task settles only when every run it spawned has finished.
  const { data: runRows, error } = await admin
    .from("task_runs")
    .select("id, status, output")
    .contains("payload", { briefId })
  if (error) throw new Error(`task_runs: ${error.message}`)
  const rows = (runRows ?? []) as Array<{ id: string; status: string; output: string | null }>
  const terminal = new Set(["succeeded", "failed", "cancelled"])
  if (rows.length === 0 || !rows.every((r) => terminal.has(r.status))) return

  const allSucceeded = rows.every((r) => r.status === "succeeded")
  const digest = rows
    .filter((r) => r.status === "succeeded" && r.output)
    .map((r) => (r.output ?? "").trim().split("\n")[0])
    .filter(Boolean)
    .join(" · ")
    .slice(0, 2000)
  await admin
    .from("project_briefs")
    .update({
      state: allSucceeded ? "succeeded" : "failed",
      output_summary: digest,
      error: allSucceeded ? null : "one or more subagents did not finish",
      finished_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", briefId)
}

/** Hard ceiling on any brief's budget. Same env knob the run queue uses. */
export function maxBriefBudgetCents(): number {
  const raw = Number(process.env.WORKER_MAX_BUDGET_CENTS)
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 2000
}

/** Workspace agents the owner can address with @mention: display name and the runtime key chat uses. */
export async function loadRoster(client: SupabaseClient, workspaceId: string): Promise<RosterEntry[]> {
  const { data, error } = await client
    .from("agents")
    .select("runtime_agent, display_name, kind")
    .eq("workspace_id", workspaceId)
  if (error) throw new Error(`agents: ${error.message}`)
  return ((data ?? []) as Array<{ runtime_agent: string; display_name: string; kind: string }>).map((a) => ({
    key: a.runtime_agent,
    displayName: a.display_name,
    isChief: a.kind === "chief_of_staff",
  }))
}

/** The chief's runtime key for a workspace. Null when the workspace has no agents yet. */
export async function chiefKey(client: SupabaseClient, workspaceId: string): Promise<string | null> {
  return pickChief(await loadRoster(client, workspaceId))?.key ?? null
}
