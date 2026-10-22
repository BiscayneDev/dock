import type { SupabaseClient } from "@supabase/supabase-js"
import { generateText } from "ai"
import { buildModel, collectRunTelemetry, resolveModel } from "@/lib/inference"
import { createShipyardCapture } from "@/lib/inference/shipyard-capture"
import { CHIEF_RUNTIME_AGENT } from "@/lib/tenancy"
import { chiefPromptFor, callEstimateCents } from "@/lib/worker"
import { addEvent, addSpend, complete, getRun, listEvents, parkForApproval } from "@/lib/queue"
import {
  canSpend,
  centsFromUsd,
  decideMoneyGate,
  EVENT,
  isMoneyAction,
  proposedActionFromPayload,
} from "@/lib/task-runs"
import { allowedDeviceCompletion, deviceWorkerId, DEVICE_COMPLETE_STATUSES } from "@/lib/device-rules"
import { modeForRun, PLAN_MODE_INSTRUCTION } from "@/lib/tool-permissions"

// Home-node run actions (P2). The device holds the lease; the server does the model call and the bookkeeping,
// so cloud and home runs share one budget ledger (task_runs.spent_cents) and one money gate.
// Money-type actions never run on the home node: they are parked for approval and refused here otherwise.

export type HomeResult<T> = { ok: true; value: T } | { ok: false; status: number; error: string }

async function heldRunFor(admin: SupabaseClient, deviceId: string, runId: string) {
  const run = await getRun(admin, runId)
  if (!run) return { run: null, error: { status: 404, error: "run not found" } as const }
  const held = run.leaseOwner === deviceWorkerId(deviceId) && (run.status === "leased" || run.status === "running")
  if (!held) return { run: null, error: { status: 409, error: "run is not leased to this device" } as const }
  return { run, error: null }
}

/** One model call for a run this device holds. Budget checked before the call; spend metered after it. */
export async function inferForDevice(
  admin: SupabaseClient,
  deviceId: string,
  runId: string,
): Promise<HomeResult<{ text: string; costCents: number; spentCents: number }>> {
  const { run, error } = await heldRunFor(admin, deviceId, runId)
  if (!run) return { ok: false, ...error }
  const worker = deviceWorkerId(deviceId)

  const proposed = proposedActionFromPayload(run.payload)
  if (proposed && isMoneyAction(proposed)) {
    return { ok: false, status: 409, error: "money action is not executed on the home node" }
  }

  const estimate = callEstimateCents()
  if (!canSpend(run.spentCents, estimate, run.budgetCents)) {
    await addEvent(admin, run.id, EVENT.budgetRefused, {
      spentCents: run.spentCents,
      estimateCents: estimate,
      budgetCents: run.budgetCents,
      target: "home",
    })
    return { ok: false, status: 409, error: "budget" }
  }

  const prompt = typeof run.payload.prompt === "string" ? run.payload.prompt : ""
  if (!prompt.trim()) return { ok: false, status: 409, error: "empty prompt" }

  const capture = createShipyardCapture()
  const model = run.model ? buildModel(run.model, capture) : resolveModel(run.agentKey, capture)
  if (!model) return { ok: false, status: 409, error: "no model configured" }
  const system = run.agentKey === CHIEF_RUNTIME_AGENT ? await chiefPromptFor(admin, run) : null
  // Same plan-mode gate as the cloud worker: kanban state forbids file/command tools in plan mode.
  const planMode = modeForRun(run.payload) === "plan"
  const effectiveSystem = [system, planMode ? PLAN_MODE_INSTRUCTION : null].filter(Boolean).join("\n\n") || null

  const remainingMs = 150_000
  try {
    const result = await generateText({
      model: model.model,
      prompt,
      ...(effectiveSystem ? { system: effectiveSystem } : {}),
      abortSignal: AbortSignal.timeout(remainingMs),
    })
    const telemetry = collectRunTelemetry(result.steps, capture)
    const reported = centsFromUsd(telemetry?.costUsd)
    const costCents = reported ?? estimate
    await addEvent(admin, run.id, EVENT.modelCall, {
      model: model.label,
      inputTokens: telemetry?.inputTokens ?? null,
      outputTokens: telemetry?.outputTokens ?? null,
      costCents,
      estimated: reported === null,
      target: "home",
    })
    if (reported === null) await addEvent(admin, run.id, EVENT.costUnknown, { chargedCents: costCents })
    const spentCents = await addSpend(admin, run, worker, costCents)
    return { ok: true, value: { text: result.text, costCents, spentCents } }
  } catch (err) {
    const message = err instanceof Error ? err.message : "model call failed"
    return { ok: false, status: 502, error: message.slice(0, 300) }
  }
}

export interface CompleteBody {
  status: string
  output?: string | null
  error?: string | null
}

/**
 * Device completes a run it holds. Enforces the transition table and the money gate:
 * - succeeded with an unapproved money action is refused (it must be parked for approval first);
 * - awaiting_approval parks a money action for the owner and writes approval_requested (the gate);
 * - a money action that is already approved cannot run on the home node and is refused.
 */
export async function completeForDevice(
  admin: SupabaseClient,
  deviceId: string,
  runId: string,
  body: CompleteBody,
): Promise<HomeResult<{ id: string; status: string; parked: boolean }>> {
  const { run, error } = await heldRunFor(admin, deviceId, runId)
  if (!run) return { ok: false, ...error }
  const worker = deviceWorkerId(deviceId)

  const status = body.status
  if (!(DEVICE_COMPLETE_STATUSES as readonly string[]).includes(status)) {
    return { ok: false, status: 400, error: "invalid status" }
  }
  if (!allowedDeviceCompletion(run.status, status)) {
    return { ok: false, status: 409, error: "transition not allowed" }
  }

  const proposed = proposedActionFromPayload(run.payload)
  const money = proposed !== null && isMoneyAction(proposed)
  const events = await listEvents(admin, run.id)
  const gate = proposed && money ? decideMoneyGate(proposed, events) : null

  if (status === "awaiting_approval") {
    if (!proposed || !money || !gate) return { ok: false, status: 400, error: "no money action to approve" }
    if (gate.kind === "request_approval") {
      await addEvent(admin, run.id, EVENT.approvalRequested, {
        actionId: proposed.id,
        type: proposed.type,
        amountCents: proposed.amountCents ?? null,
        destination: proposed.destination ?? null,
        description: proposed.description ?? null,
        target: "home",
      })
      await parkForApproval(admin, run.id, worker)
      return { ok: true, value: { id: run.id, status: "awaiting_approval", parked: true } }
    }
    return { ok: false, status: 409, error: "money action already decided; it runs only on the cloud executor" }
  }

  if (status === "succeeded" && money && (!gate || gate.kind !== "execute")) {
    return { ok: false, status: 409, error: "money action requires approval" }
  }
  if (status === "succeeded" && money) {
    return { ok: false, status: 409, error: "approved money action is not executed on the home node" }
  }

  const output = typeof body.output === "string" ? body.output.slice(0, 200_000) : null
  const errText = typeof body.error === "string" ? body.error.slice(0, 1000) : null
  const done = await complete(admin, run.id, worker, {
    status: status as "succeeded" | "failed" | "cancelled",
    output,
    error: errText,
  })
  if (!done) return { ok: false, status: 409, error: "lease lost" }
  return { ok: true, value: { id: run.id, status, parked: false } }
}
