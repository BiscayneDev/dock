/**
 * Task-run rules (P2). Pure functions only: no I/O, no imports, so the node tests can load this file directly.
 *
 * Spend gate: any action that moves money is never executed by the worker's model turn. It is gated to
 * `awaiting_approval`, and only an owner approval event unlocks execution through `executeApprovedAction`.
 * Budget: a model call is refused when spent + estimate would exceed the run's budget (reason 'budget').
 */

export const RUN_STATUSES = [
  "queued",
  "leased",
  "running",
  "awaiting_approval",
  "succeeded",
  "failed",
  "cancelled",
] as const
export type RunStatus = (typeof RUN_STATUSES)[number]

export const RUN_TARGETS = ["cloud", "home", "sandbox"] as const
export type RunTarget = (typeof RUN_TARGETS)[number]

export const TERMINAL_STATUSES: readonly RunStatus[] = ["succeeded", "failed", "cancelled"]

/** Action types that move money. Every one of these goes through the approval gate. */
export const MONEY_ACTION_TYPES = ["x402_spend", "moonpay_refund", "payout_change"] as const
export type MoneyActionType = (typeof MONEY_ACTION_TYPES)[number]

export interface ProposedAction {
  /** Stable id so approval events can be matched to the action they approve. */
  id: string
  type: string
  amountCents?: number
  destination?: string
  description?: string
}

export function isMoneyAction(action: ProposedAction): boolean {
  return (MONEY_ACTION_TYPES as readonly string[]).includes(action.type)
}

export interface RunEventLike {
  kind: string
  data: Record<string, unknown>
}

/** Event kinds written by the worker and by the approval endpoints. */
export const EVENT = {
  leased: "leased",
  started: "started",
  checkpoint: "checkpoint",
  leaseExpired: "lease_expired",
  heartbeat: "heartbeat",
  budgetRefused: "budget_refused",
  approvalRequested: "approval_requested",
  approvalGranted: "approval_granted",
  approvalRejected: "approval_rejected",
  actionExecuted: "action_executed",
  actionFailed: "action_failed",
  modelCall: "model_call",
  costUnknown: "cost_unknown",
  completed: "completed",
  failed: "failed",
  cancelled: "cancelled",
} as const

/** True when the spend cap allows one more call of `estimateCents` on top of `spentCents`. */
export function canSpend(spentCents: number, estimateCents: number, budgetCents: number): boolean {
  if (![spentCents, estimateCents, budgetCents].every((n) => Number.isFinite(n) && n >= 0)) return false
  return spentCents + estimateCents <= budgetCents
}

/** Whole cents from a USD cost reported by the gateway. Rounds up so spend is never under-counted. */
export function centsFromUsd(costUsd: number | null | undefined): number | null {
  if (typeof costUsd !== "number" || !Number.isFinite(costUsd) || costUsd < 0) return null
  return Math.ceil(costUsd * 100 - 1e-9)
}

export type GateDecision =
  | { kind: "none" }
  | { kind: "request_approval"; action: ProposedAction }
  | { kind: "execute"; action: ProposedAction }
  | { kind: "rejected"; action: ProposedAction }
  | { kind: "already_done"; action: ProposedAction }

/**
 * What the worker does with a run's proposed money action, given the run's event history.
 * - no money action            -> none (the model turn proceeds)
 * - no approval decision yet   -> request_approval (run goes to awaiting_approval, nothing executes)
 * - approved, not yet executed -> execute (the only path that reaches an executor)
 * - rejected                   -> rejected (run is cancelled)
 * - already executed           -> already_done (a retry never repeats a money action)
 */
export function decideMoneyGate(proposed: ProposedAction | null, events: RunEventLike[]): GateDecision {
  if (!proposed || !isMoneyAction(proposed)) return { kind: "none" }
  const forThis = (e: RunEventLike) => e.data?.actionId === proposed.id
  if (events.some((e) => e.kind === EVENT.actionExecuted && forThis(e))) {
    return { kind: "already_done", action: proposed }
  }
  if (events.some((e) => e.kind === EVENT.approvalRejected && forThis(e))) {
    return { kind: "rejected", action: proposed }
  }
  if (events.some((e) => e.kind === EVENT.approvalGranted && forThis(e))) {
    return { kind: "execute", action: proposed }
  }
  return { kind: "request_approval", action: proposed }
}

/** Executes a money action. Injected per call so tests can use a fake; production uses the real map. */
export type MoneyExecutor = (action: ProposedAction) => Promise<{ reference: string | null }>

/**
 * Real money executors. Not implemented in P2: the x402 rail and MoonPay refunds are wired in a later
 * task. Each stub throws, and the worker only reaches them after an owner approval event.
 */
export const DEFAULT_MONEY_EXECUTORS: Record<MoneyActionType, MoneyExecutor> = {
  x402_spend: async () => {
    throw new Error("not implemented: x402 spend")
  },
  moonpay_refund: async () => {
    throw new Error("not implemented: moonpay refund")
  },
  payout_change: async () => {
    throw new Error("not implemented: payout change")
  },
}

/** Runs an approved money action through the executor map. Refuses anything that is not a money action. */
export async function executeApprovedAction(
  action: ProposedAction,
  executors: Record<string, MoneyExecutor> = DEFAULT_MONEY_EXECUTORS,
): Promise<{ reference: string | null }> {
  if (!isMoneyAction(action)) throw new Error(`refusing to execute non-money action: ${action.type}`)
  const executor = executors[action.type]
  if (!executor) throw new Error(`no executor for action type: ${action.type}`)
  return executor(action)
}

/** Parses the proposed action from a run payload. Returns null when absent or malformed. */
export function proposedActionFromPayload(payload: Record<string, unknown>): ProposedAction | null {
  const raw = payload.proposedAction
  if (!raw || typeof raw !== "object") return null
  const a = raw as Record<string, unknown>
  if (typeof a.id !== "string" || a.id.length === 0 || a.id.length > 80) return null
  if (typeof a.type !== "string" || a.type.length === 0 || a.type.length > 64) return null
  return {
    id: a.id,
    type: a.type,
    amountCents: typeof a.amountCents === "number" ? a.amountCents : undefined,
    destination: typeof a.destination === "string" ? a.destination.slice(0, 200) : undefined,
    description: typeof a.description === "string" ? a.description.slice(0, 500) : undefined,
  }
}

/** Owner check for a decision. Service-role callers (the Dinghy connector) pass no user and are trusted. */
export function canDecideRun(ownerId: string, userId: string | null | undefined): boolean {
  return userId === null || userId === undefined || ownerId === userId
}

export type DecisionPlan =
  | { ok: true; actionId: string; amountCents: number | null }
  | { ok: false; reason: "not_awaiting_approval" | "no_pending_action" | "already_decided" }

/**
 * Whether an owner decision can be recorded now. A second decision on the same action is refused
 * (already_decided), so a double click never writes a second grant or rejection.
 */
export function planDecision(status: string, events: RunEventLike[]): DecisionPlan {
  if (status !== "awaiting_approval") return { ok: false, reason: "not_awaiting_approval" }
  const requested = [...events].reverse().find((e) => e.kind === EVENT.approvalRequested)
  if (!requested) return { ok: false, reason: "no_pending_action" }
  const actionId = requested.data.actionId
  const decided = events.some(
    (e) => (e.kind === EVENT.approvalGranted || e.kind === EVENT.approvalRejected) && e.data.actionId === actionId,
  )
  if (decided) return { ok: false, reason: "already_decided" }
  const amount = requested.data.amountCents
  return {
    ok: true,
    actionId: String(actionId ?? ""),
    amountCents: typeof amount === "number" && Number.isFinite(amount) ? amount : null,
  }
}

/** Status a run moves to on an owner decision. Approve re-queues it; reject cancels it. */
export function statusAfterDecision(decision: "approve" | "reject"): "queued" | "cancelled" {
  return decision === "approve" ? "queued" : "cancelled"
}

export type ResumePlan =
  | { ok: true; fromStep: number; snapshot: Record<string, unknown> | null }
  | { ok: false; reason: "terminal" }

/**
 * Whether a run may be resumed, and if so where it restarts from. Terminal runs (succeeded, failed,
 * cancelled) are never resumed. Otherwise the run restarts at the step recorded in the LAST checkpoint
 * event (step 0 / null snapshot when there is none), so a retried run skips completed work.
 */
export function resumePlan(status: string, events: RunEventLike[]): ResumePlan {
  if ((TERMINAL_STATUSES as readonly string[]).includes(status)) return { ok: false, reason: "terminal" }
  const checkpoint = [...events].reverse().find((e) => e.kind === EVENT.checkpoint)
  if (!checkpoint) return { ok: true, fromStep: 0, snapshot: null }
  const step = checkpoint.data.step
  return {
    ok: true,
    fromStep: typeof step === "number" && Number.isFinite(step) ? step : 0,
    snapshot: (checkpoint.data.snapshot as Record<string, unknown> | undefined) ?? null,
  }
}
