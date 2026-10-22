import type { SupabaseClient } from "@supabase/supabase-js"
import { enqueueRun, type TaskRun } from "@/lib/queue"
import { resolveModelRef } from "@/lib/inference"
import {
  canApprove,
  canCancel,
  pickChief,
  type RosterEntry,
  composeRunPrompt,
  outcomeForRun,
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
  "id, workspace_id, owner_id, project_id, conversation_id, run_id, agent_key, goal, context, deliverables, budget_cents, risk_flags, state, output_summary, error, created_at, updated_at, decided_at, finished_at"

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
        agent_key: p.agentKey ?? input.defaultAgentKey,
        goal: p.goal,
        context: p.context,
        deliverables: p.deliverables,
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

/**
 * Owner approves a brief. The state flip is a conditional update (proposed -> approved), so a double click
 * cannot create two runs. Then the run is queued with the brief's budget. If queueing fails, the brief goes back to proposed.
 */
export async function approveBrief(
  client: SupabaseClient,
  scope: Scope,
  briefId: string,
  maxBudgetCents: number,
): Promise<{ brief: Brief; run: TaskRun }> {
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

  const model = resolveModelRef(current.agentKey)
  let run: TaskRun
  try {
    if (!model) throw new Error("No model configured for this agent")
    run = await enqueueRun(client, {
      workspaceId: scope.workspaceId,
      ownerId: scope.ownerId,
      projectId: current.projectId,
      agentId: null,
      agentKey: current.agentKey,
      target: "cloud",
      prompt: composeRunPrompt({
        goal: current.goal,
        context: current.context,
        deliverables: current.deliverables,
        budgetCents: Math.min(current.budgetCents, maxBudgetCents),
        riskFlags: current.riskFlags,
      }),
      model,
      budgetCents: Math.min(current.budgetCents, maxBudgetCents),
      briefId: current.id,
    })
  } catch (error) {
    await client.from("project_briefs").update({ state: "proposed", decided_at: null }).eq("id", briefId)
    throw error
  }

  const { data: updated, error: linkError } = await client
    .from("project_briefs")
    .update({ state: "running", run_id: run.id, updated_at: new Date().toISOString() })
    .eq("id", briefId)
    .select(BRIEF_COLS)
    .single()
  if (linkError || !updated) throw new Error(`briefs: ${linkError?.message ?? "link failed"}`)

  await writeLedger(client, scope, {
    projectId: current.projectId,
    briefId: current.id,
    runId: run.id,
    kind: "run_started",
    agentKey: current.agentKey,
    summary: `Approved: ${current.goal}`,
  })
  return { brief: toBrief(updated as unknown as Row), run }
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
  const { briefState, ledgerKind } = outcomeForRun(status)
  const summary = (detail.output ?? "").trim().slice(0, 2000)
  await admin
    .from("project_briefs")
    .update({
      state: briefState,
      output_summary: summary,
      error: detail.error ? detail.error.slice(0, 1000) : null,
      finished_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", briefId)

  await writeLedger(admin, { workspaceId: run.workspaceId, ownerId: run.ownerId }, {
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
    const content =
      status === "succeeded"
        ? summary || "Finished with no output."
        : `The run stopped: ${detail.error ?? status}.`
    await admin.from("messages").insert({
      conversation_id: brief.conversationId,
      role: "agent",
      content,
      agent: run.agentKey,
      meta: { kind: "result", briefId, runId: run.id },
    })
    await admin.from("conversations").update({ updated_at: new Date().toISOString() }).eq("id", brief.conversationId)
  }
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
