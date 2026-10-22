import { generateText } from "ai"
import type { SupabaseClient } from "@supabase/supabase-js"
import { buildModel, collectRunTelemetry, resolveModel } from "@/lib/inference"
import { createShipyardCapture } from "@/lib/inference/shipyard-capture"
import { chiefKey, recordRunOutcome } from "@/lib/briefs-store"
import { captureApprovalPreview } from "@/lib/approval-preview"
import {
  approvalRouteFields,
  previewRoute,
  SHIPYARD_AUTO_MODEL,
  type RouteMessage,
} from "@/lib/route-preview"
import { previewTargetFromRun } from "@/lib/preview-guard"
import { buildChiefPrompt, loadProfile, loadRules, loadVentureProfile } from "@/lib/onboarding-server"
import {
  addEvent,
  addSpend,
  claimNext,
  complete,
  DEFAULT_LEASE_SECONDS,
  heartbeat,
  listEvents,
  markRunning,
  parkForApproval,
  type TaskRun,
} from "@/lib/queue"
import {
  canSpend,
  centsFromUsd,
  decideMoneyGate,
  DEFAULT_MONEY_EXECUTORS,
  EVENT,
  executeApprovedAction,
  proposedActionFromPayload,
  resumePlan,
  type MoneyExecutor,
} from "@/lib/task-runs"
import { checkpointData, continuationPrompt } from "@/lib/run-resume"
import { PLAN_MODE_INSTRUCTION } from "@/lib/tool-permissions"
import { resolveRunMode } from "@/lib/agent-mode"

// Cloud worker runner (P2). Each tick claims up to N runs and works them in order within a time budget.
// Rules: money actions are gated before any model call; every model call is budget-checked and metered.

/** Per-call estimate used for the budget check before a call. Env-tunable, conservative default. */
export function callEstimateCents(): number {
  const raw = Number(process.env.WORKER_CALL_ESTIMATE_CENTS)
  return Number.isFinite(raw) && raw > 0 ? Math.ceil(raw) : 10
}

export interface TickOptions {
  workerId: string
  maxRuns: number
  /** Absolute time (ms since epoch) after which no new work starts. */
  deadlineMs: number
  executors?: Record<string, MoneyExecutor>
}

export interface TickSummary {
  claimed: number
  outcomes: Array<{ runId: string; outcome: string }>
}

/** Chief-owned runs get the same prompt the interactive chat uses, built with the service-role client. */
export async function chiefPromptFor(admin: SupabaseClient, run: TaskRun): Promise<string | null> {
  const [profile, rules, venture] = await Promise.all([
    loadProfile(admin, run.workspaceId),
    loadRules(admin, run.workspaceId),
    run.projectId ? loadVentureProfile(admin, run.projectId) : Promise.resolve(null),
  ])
  let project: Parameters<typeof buildChiefPrompt>[2] = null
  if (run.projectId) {
    const { data } = await admin.from("projects").select("name").eq("id", run.projectId).maybeSingle()
    if (data) {
      const projectRules = await loadRules(admin, run.workspaceId, run.projectId)
      project = { name: data.name as string, profile: venture, rules: projectRules }
    }
  }
  return buildChiefPrompt(profile, rules, project)
}

async function finish(
  admin: SupabaseClient,
  run: TaskRun,
  workerId: string,
  status: "succeeded" | "failed" | "cancelled",
  detail: { output?: string | null; error?: string | null },
): Promise<string> {
  await complete(admin, run.id, workerId, { status, ...detail })
  // Brief-linked runs write their outcome back to the brief, the ledger and the central thread. Never fails the run.
  const briefId = typeof run.payload.briefId === "string" ? run.payload.briefId : null
  if (briefId) {
    await recordRunOutcome(admin, run, briefId, status, detail).catch(() => null)
  }
  return status === "succeeded" ? "succeeded" : `${status}:${detail.error ?? ""}`
}

/**
 * Route preview for an approval: which model Jev would pick, and what that call would cost, for the same messages
 * the run would send. Informational only: it never blocks or changes the gate. Never throws.
 */
async function routeForApproval(admin: SupabaseClient, run: TaskRun) {
  try {
    if (run.model !== SHIPYARD_AUTO_MODEL) return approvalRouteFields({ ok: false, reason: "model_chosen" })
    const prompt = typeof run.payload.prompt === "string" ? run.payload.prompt : ""
    if (!prompt.trim()) return approvalRouteFields({ ok: false, reason: "preview_error" })
    const system = run.agentKey === (await chiefKey(admin, run.workspaceId)) ? await chiefPromptFor(admin, run) : null
    const messages: RouteMessage[] = [
      ...(system ? [{ role: "system" as const, content: system }] : []),
      { role: "user" as const, content: prompt },
    ]
    return approvalRouteFields(await previewRoute(messages))
  } catch {
    return approvalRouteFields({ ok: false, reason: "preview_error" })
  }
}

/** Works one claimed run. Returns a short outcome label for the tick summary. */
export async function processRun(admin: SupabaseClient, run: TaskRun, opts: TickOptions): Promise<string> {
  const workerId = opts.workerId
  const executors = opts.executors ?? DEFAULT_MONEY_EXECUTORS
  if (!(await markRunning(admin, run.id, workerId))) return "lease_lost"
  await addEvent(admin, run.id, EVENT.started, { worker: workerId, attempt: run.attempts })

  // 1. Money gate. Nothing that moves money runs here; only an approved action reaches an executor.
  const events = await listEvents(admin, run.id)
  const gate = decideMoneyGate(proposedActionFromPayload(run.payload), events)
  if (gate.kind === "request_approval") {
    const a = gate.action
    // Preview for the human approver. One capture, bounded to 15s, never blocks the approval: on failure the
    // approval is still created and the card shows the reason. The screenshot never authorises the action.
    const preview = await captureApprovalPreview(admin, {
      ownerId: run.ownerId,
      runId: run.id,
      target: previewTargetFromRun(run.payload, a.destination),
    })
    // Model route preview (Shipyard /v1/route). Bounded to 5s; a failure is stored as routeReason, never blocks.
    const routeFields = await routeForApproval(admin, run)
    await addEvent(admin, run.id, EVENT.approvalRequested, {
      actionId: a.id,
      type: a.type,
      amountCents: a.amountCents ?? null,
      destination: a.destination ?? null,
      description: a.description ?? null,
      // Card fields (approval card in /assistant). Null means unknown; the card never guesses.
      proposal: a.description ?? null,
      target: a.destination ?? null,
      estimatedCents: a.amountCents ?? null,
      budgetCents: run.budgetCents,
      model: run.model,
      modelReason: typeof run.payload.modelReason === "string" ? run.payload.modelReason : null,
      ...routeFields,
      projectId: run.projectId,
      conversationId: typeof run.payload.conversationId === "string" ? run.payload.conversationId : null,
      // Only the capture step sets these. A screenshotUrl supplied by the agent payload is ignored.
      ...(preview.ok
        ? {
            screenshotUrl: preview.screenshotUrl,
            screenshotPath: preview.screenshotPath,
            screenshotExpiresAt: preview.screenshotExpiresAt,
          }
        : { screenshotUrl: null, previewFailed: preview.reason }),
    })
    await parkForApproval(admin, run.id, workerId)
    return "awaiting_approval"
  }
  if (gate.kind === "rejected") return finish(admin, run, workerId, "cancelled", { error: "rejected by owner" })
  if (gate.kind === "execute") {
    try {
      const result = await executeApprovedAction(gate.action, executors)
      await addEvent(admin, run.id, EVENT.actionExecuted, { actionId: gate.action.id, reference: result.reference })
    } catch (error) {
      const message = error instanceof Error ? error.message : "action failed"
      await addEvent(admin, run.id, EVENT.actionFailed, { actionId: gate.action.id, error: message })
      return finish(admin, run, workerId, "failed", { error: message })
    }
  }

  // 2. Budget. Refuse the call before it is made, not after.
  const estimate = callEstimateCents()
  if (!canSpend(run.spentCents, estimate, run.budgetCents)) {
    await addEvent(admin, run.id, EVENT.budgetRefused, {
      spentCents: run.spentCents,
      estimateCents: estimate,
      budgetCents: run.budgetCents,
    })
    return finish(admin, run, workerId, "failed", { error: "budget" })
  }

  // 3. Time budget. Do not start a call with too little time left; the lease expires and the next tick retries.
  const remaining = opts.deadlineMs - Date.now()
  if (remaining < 20_000) return "deferred"

  // 4. Model call through the inference layer, metered from the gateway's cost telemetry.
  const capture = createShipyardCapture()
  const model = run.model ? buildModel(run.model, capture) : resolveModel(run.agentKey, capture)
  if (!model) return finish(admin, run, workerId, "failed", { error: "no model configured" })
  const prompt = typeof run.payload.prompt === "string" ? run.payload.prompt : ""
  if (!prompt.trim()) return finish(admin, run, workerId, "failed", { error: "empty prompt" })

  // Resume: a retried run with a checkpoint carries its prior output as continuation context.
  // The event history is the audit trail; nothing extra is logged. Belt-and-braces: a checkpoint
  // stashed in the payload by the approval path is honored when the events have none.
  const plan = resumePlan(run.status, events)
  let snapshot: Record<string, unknown> | null = null
  if (plan.ok && plan.fromStep > 0 && plan.snapshot) {
    snapshot = plan.snapshot
  } else if (plan.ok) {
    const resume = run.payload.resume
    if (resume && typeof resume === "object" && typeof (resume as Record<string, unknown>).output === "string") {
      snapshot = resume as Record<string, unknown>
    }
  }
  const effectivePrompt = snapshot ? continuationPrompt(prompt, snapshot) : prompt

  const system = run.agentKey === (await chiefKey(admin, run.workspaceId)) ? await chiefPromptFor(admin, run) : null

  // Kanban state gates permissions: plan mode forbids file/command tools in the system prompt and
  // marks the output as a plan (enrichment), never a finished deliverable.
  // payload.mode is the single source of truth at runtime (set at enqueue time); column mapping is
  // resolveRunMode's fallback for legacy runs without a mode.
  const mode = resolveRunMode(run.payload)
  const isPlan = mode === "plan"
  const effectiveSystem = [system, isPlan ? PLAN_MODE_INSTRUCTION : null].filter(Boolean).join("\n\n") || null

  await heartbeat(admin, run.id, workerId, DEFAULT_LEASE_SECONDS)
  try {
    const result = await generateText({
      model: model.model,
      prompt: effectivePrompt,
      ...(effectiveSystem ? { system: effectiveSystem } : {}),
      abortSignal: AbortSignal.timeout(Math.min(remaining, 150_000)),
    })
    const telemetry = collectRunTelemetry(result.steps, capture)
    // The model the gateway actually served (x-shipyard-model header, read by the capture). Null if not Shipyard.
    const served = capture.calls[capture.calls.length - 1]
    const reportedCents = centsFromUsd(telemetry?.costUsd)
    // Unknown cost (e.g. BYO-key providers report none) is charged the estimate, so the cap still bites.
    const costCents = reportedCents ?? estimate
    await addEvent(admin, run.id, EVENT.modelCall, {
      model: model.label,
      servedModel: served?.model ?? null,
      servedProvider: served?.provider ?? null,
      inputTokens: telemetry?.inputTokens ?? null,
      outputTokens: telemetry?.outputTokens ?? null,
      costCents,
      estimated: reportedCents === null,
    })
    if (reportedCents === null) await addEvent(admin, run.id, EVENT.costUnknown, { chargedCents: costCents })
    await addSpend(admin, run, workerId, costCents)
    // Plan mode: the output is enrichment on the task, not a finished deliverable.
    if (isPlan) {
      const { error: payloadError } = await admin
        .from("task_runs")
        .update({ payload: { ...run.payload, mode: "plan", planOutput: true }, updated_at: new Date().toISOString() })
        .eq("id", run.id)
      // Never fails the run: the output is already stored.
      void payloadError
    }
    // Checkpoint BEFORE finishing: if the run is retried (lease loss, retry after failure),
    // resumePlan reads this and the next attempt continues from the prior output.
    // Wrapped as { step, snapshot } so resumePlan's step/snapshot shape matches.
    await addEvent(admin, run.id, EVENT.checkpoint, {
      step: 1,
      snapshot: checkpointData(result.text, run.spentCents + costCents),
    })
    return finish(admin, { ...run, spentCents: run.spentCents + costCents }, workerId, "succeeded", {
      output: result.text,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "model call failed"
    // Checkpoint on the failure path too: a retried run resumes from this event. The failed
    // call carries no partial output we can rely on, so store an empty-output snapshot with
    // the run's spend so the retry at least resumes the ledger state (fromStep > 0).
    await addEvent(admin, run.id, EVENT.checkpoint, {
      step: 1,
      snapshot: checkpointData("", run.spentCents),
    })
    return finish(admin, run, workerId, "failed", { error: message.slice(0, 1000) })
  }
}

/** Claims and works runs until the batch is full, the queue is empty, or the deadline passes. */
export async function runTick(admin: SupabaseClient, opts: TickOptions): Promise<TickSummary> {
  const summary: TickSummary = { claimed: 0, outcomes: [] }
  while (summary.claimed < opts.maxRuns && Date.now() < opts.deadlineMs - 20_000) {
    const run = await claimNext(admin, opts.workerId, DEFAULT_LEASE_SECONDS)
    if (!run) break
    summary.claimed += 1
    try {
      const outcome = await processRun(admin, run, opts)
      summary.outcomes.push({ runId: run.id, outcome })
    } catch (error) {
      const message = error instanceof Error ? error.message : "worker error"
      summary.outcomes.push({ runId: run.id, outcome: `error:${message.slice(0, 200)}` })
      await complete(admin, run.id, opts.workerId, { status: "failed", error: message.slice(0, 1000) }).catch(() => null)
    }
  }
  return summary
}
