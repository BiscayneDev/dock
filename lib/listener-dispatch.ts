/**
 * Listener dispatch (WS4). Pure decisions plus one orchestration function used by the webhook route.
 *
 * Order of operations for an inbound webhook delivery:
 *   1. verify the bearer token (parse -> load row -> timingSafeEqual against the stored hash)
 *   2. disabled/paused checks (stop dispatching while paused)
 *   3. event-id dedupe inside the replay window
 *   4. cheap filter-rules pre-check (no model call) + rolling rate limit
 *   5. enqueue through the existing lib/queue.ts enqueueRun, then attach
 *      { kind: "listener", listenerId, correlationId, event } to the run payload
 *   6. record a task_run_events trace row and a listener_deliveries audit row
 *   7. circuit breaker: >=10 errored deliveries among the last 20 pauses the listener
 *
 * The enqueue/event side effects are injected, so the whole flow runs against an in-memory fake in
 * test/listeners.test.mjs. lib/queue.ts and lib/task-runs.ts are never imported here.
 */
import { createHash, randomUUID } from "crypto";
import {
  CIRCUIT_BREAKER_ERRORS,
  CIRCUIT_BREAKER_WINDOW,
  DEFAULT_MAX_ENQUEUES_PER_MINUTE,
  REPLAY_WINDOW_SECONDS,
  decideListener,
  rateLimit,
  stableStringify,
} from "./listener-rules.ts";
import {
  parseListenerToken,
  verifyListenerToken,
  type ListenerDeliveryRow,
  type ListenerRepo,
  type ListenerRow,
} from "./listeners.ts";

export const LISTENER_TRIGGERED_EVENT = "listener.triggered";
export const LISTENER_RUN_MODEL = "auto";
export const DEFAULT_LISTENER_BUDGET_CENTS = 100;
const MAX_DETAIL = 900;

export interface EnqueueJob {
  workspaceId: string;
  ownerId: string;
  agentKey: string;
  prompt: string;
  model: string | null;
  budgetCents: number;
  target: string;
  explore?: boolean;
}

export interface EnqueueResult {
  id: string;
  payload?: Record<string, unknown>;
}

export interface DispatchDeps {
  enqueue(job: EnqueueJob): Promise<EnqueueResult>;
  /** Replaces the run payload (dispatch passes the full merged payload, prompt included). */
  patchRunPayload(runId: string, payload: Record<string, unknown>): Promise<void>;
  recordEvent(runId: string, kind: string, data: Record<string, unknown>): Promise<void>;
  /** Agent explore flag lookup (read-only enforcement); defaults to false. */
  resolveExplore?(agentKey: string): Promise<boolean>;
  now(): Date;
  newCorrelationId(): string;
}

export interface ReceiveInput {
  repo: ListenerRepo;
  token: string | null | undefined;
  /** Parsed JSON body (arbitrary JSON). */
  body: unknown;
  idempotencyKey?: string | null;
  replayWindowSeconds?: number;
  maxPerMinute?: number;
  budgetCents?: number;
  model?: string | null;
}

export type DispatchStatus = "enqueued" | "filtered" | "deduped" | "paused" | "error";

export interface DispatchPlan {
  status: DispatchStatus;
  reason: string;
  detail?: string;
  runId?: string;
  correlationId?: string;
  eventId?: string;
  listenerId?: string;
}

// ---------------------------------------------------------------------------
// Pure helpers (node-testable)
// ---------------------------------------------------------------------------

/** Stable event id: the Idempotency-Key when supplied, otherwise a hash of the canonical body. */
export function eventIdFor(body: unknown, idempotencyKey?: string | null): string {
  const key = typeof idempotencyKey === "string" ? idempotencyKey.trim() : "";
  if (key.length > 0 && key.length <= 200) return `key_${key}`;
  return `evt_${createHash("sha256").update(stableStringify(body), "utf8").digest("hex")}`;
}

export interface CircuitBreakerVerdict {
  open: boolean;
  errors: number;
  considered: number;
  reason: string;
}

/**
 * Circuit breaker over the listener's most recent deliveries (ascending by time). Pauses when
 * `threshold` errors appear among the last `windowSize` deliveries.
 */
export function circuitBreakerOpen(
  deliveries: readonly ListenerDeliveryRow[],
  threshold: number = CIRCUIT_BREAKER_ERRORS,
  windowSize: number = CIRCUIT_BREAKER_WINDOW,
): CircuitBreakerVerdict {
  // deliveries are newest-first (the repo orders created_at desc).
  const consideredRows = deliveries.slice(0, Math.max(windowSize, 1));
  const errors = consideredRows.filter((row) => row.status === "error").length;
  const open = errors >= threshold && threshold > 0;
  return {
    open,
    errors,
    considered: consideredRows.length,
    reason: `circuit breaker: ${errors} errors in last ${consideredRows.length} deliveries`,
  };
}

/** The matching delivery when this event was already seen inside the replay window. */
export function findDuplicate(
  deliveries: readonly ListenerDeliveryRow[],
  eventId: string,
  nowMs: number,
  windowSeconds: number = REPLAY_WINDOW_SECONDS,
): ListenerDeliveryRow | null {
  const cutoff = nowMs - Math.max(windowSeconds, 0) * 1000;
  for (let i = deliveries.length - 1; i >= 0; i -= 1) {
    const row = deliveries[i];
    if (row.event_id !== eventId) continue;
    const at = new Date(row.created_at).getTime();
    if (Number.isFinite(at) && at >= cutoff) return row;
  }
  return null;
}

/** Rolling rate limit over the enqueued-at timestamps already returned with the delivery history. */
export function enqueueRateLimit(
  deliveries: readonly ListenerDeliveryRow[],
  nowMs: number,
  maxPerMinute: number = DEFAULT_MAX_ENQUEUES_PER_MINUTE,
) {
  return rateLimit(
    deliveries.filter((row) => row.status === "enqueued").map((row) => row.created_at),
    nowMs,
    maxPerMinute,
  );
}

function clip(text: string, max = MAX_DETAIL): string {
  const trimmed = text.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1)}…`;
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

/**
 * Handles one verified ingress delivery. Never throws: failures become status `error` plans with a
 * recorded delivery row, so a broken listener cannot take down the webhook route.
 */
export async function receiveListenerEvent(
  deps: DispatchDeps,
  input: ReceiveInput,
): Promise<DispatchPlan> {
  const now = deps.now();
  const nowMs = now.getTime();
  const nowIso = now.toISOString();
  const repo = input.repo;

  const parsed = parseListenerToken(input.token);
  if (!parsed) {
    return { status: "error", reason: "unknown_token", detail: "malformed listener token" };
  }

  let row: ListenerRow | null;
  try {
    row = await repo.getById(parsed.listenerId);
  } catch (error) {
    return { status: "error", reason: "store_unavailable", detail: clip(String(error instanceof Error ? error.message : error)) };
  }
  if (!row || !verifyListenerToken(row.token_salt, parsed.secret, row.token_hash)) {
    return { status: "error", reason: "unknown_token", detail: "listener not found or token mismatch" };
  }

  if (!row.enabled) {
    const detail = "listener disabled";
    await record(repo, row, eventIdFor(input.body, input.idempotencyKey), "paused", detail);
    return { status: "paused", reason: "disabled", detail, listenerId: row.id };
  }

  if (row.paused_at) {
    const detail = row.pause_reason ?? "paused";
    await record(repo, row, eventIdFor(input.body, input.idempotencyKey), "paused", detail);
    return { status: "paused", reason: "paused", detail, listenerId: row.id };
  }

  const eventId = eventIdFor(input.body, input.idempotencyKey);
  const windowSeconds = input.replayWindowSeconds ?? REPLAY_WINDOW_SECONDS;
  const maxPerMinute = input.maxPerMinute ?? DEFAULT_MAX_ENQUEUES_PER_MINUTE;

  let deliveries: ListenerDeliveryRow[];
  try {
    deliveries = await repo.listDeliveries(row.id, null, 200);
  } catch (error) {
    return { status: "error", reason: "store_unavailable", detail: clip(String(error instanceof Error ? error.message : error)) };
  }

  const duplicate = findDuplicate(deliveries, eventId, nowMs, windowSeconds);
  if (duplicate) {
    const detail = `duplicate of ${duplicate.id} within ${windowSeconds}s`;
    await record(repo, row, eventId, "deduped", detail);
    return { status: "deduped", reason: "duplicate", detail, eventId, listenerId: row.id };
  }

  const decision = decideListener({
    filterRules: row.filter_rules,
    event: input.body,
    nowMs,
    recentEnqueues: deliveries
      .filter((entry) => entry.status === "enqueued")
      .map((entry) => entry.created_at),
    maxPerMinute,
  });

  if (decision.decision === "filter") {
    await record(repo, row, eventId, "filtered", decision.detail);
    return {
      status: "filtered",
      reason: decision.reason,
      detail: decision.detail,
      eventId,
      listenerId: row.id,
    };
  }

  const correlationId = deps.newCorrelationId();
  const limit = enqueueRateLimit(deliveries, nowMs, maxPerMinute);
  void limit; // decideListener already enforced the cap with the same inputs

  let runId: string;
  try {
    const explore = deps.resolveExplore ? await deps.resolveExplore(row.target_agent_key) : false;
    const result = await deps.enqueue({
      workspaceId: row.workspace_id,
      ownerId: row.owner_id,
      agentKey: row.target_agent_key,
      prompt: row.runbook,
      model: input.model ?? LISTENER_RUN_MODEL,
      budgetCents: input.budgetCents ?? DEFAULT_LISTENER_BUDGET_CENTS,
      target: "cloud",
      explore,
    });
    runId = result.id;
    await deps.patchRunPayload(runId, {
      ...(result.payload ?? {}),
      kind: "listener",
      listenerId: row.id,
      correlationId,
      event: input.body,
    });
    await deps.recordEvent(runId, LISTENER_TRIGGERED_EVENT, {
      listenerId: row.id,
      eventId,
      correlationId,
    });
  } catch (error) {
    const detail = clip(error instanceof Error ? error.message : String(error));
    await record(repo, row, eventId, "error", detail);
    let verdict = circuitBreakerOpen([]);
    try {
      const recent = await repo.listDeliveries(row.id, null, CIRCUIT_BREAKER_WINDOW);
      verdict = circuitBreakerOpen(recent);
    } catch {
      // Best effort: the delivery row is already recorded.
    }
    if (verdict.open && !row.paused_at) {
      try {
        await repo.update(row.id, row.workspace_id, {
          paused_at: nowIso,
          pause_reason: verdict.reason,
        });
      } catch {
        // Best effort: the listener keeps dispatching, but the failure is audited.
      }
    }
    return {
      status: "error",
      reason: "enqueue_failed",
      detail,
      eventId,
      listenerId: row.id,
    };
  }

  try {
    await repo.update(row.id, row.workspace_id, {
      trigger_count: row.trigger_count + 1,
      last_triggered_at: nowIso,
    });
  } catch {
    // Best effort: the run exists regardless; the counter catches up on the next tick view.
  }

  await record(repo, row, eventId, "enqueued", `correlation ${correlationId}`, runId);

  return {
    status: "enqueued",
    reason: "ok",
    runId,
    correlationId,
    eventId,
    listenerId: row.id,
  };
}

async function record(
  repo: ListenerRepo,
  row: ListenerRow,
  eventId: string,
  status: ListenerDeliveryRow["status"],
  detail: string,
  runId?: string,
): Promise<void> {
  try {
    await repo.insertDelivery({
      listener_id: row.id,
      workspace_id: row.workspace_id,
      event_id: eventId,
      status,
      detail: clip(detail),
      run_id: runId ?? null,
    });
  } catch (error) {
    // Delivery rows are audit, never the source of truth for dispatch. Log and continue.
    console.error(`listener delivery record failed: ${error instanceof Error ? error.message : error}`);
  }
}
