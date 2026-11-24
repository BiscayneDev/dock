/**
 * WS5 audit trail: who did what, when, under which run.
 *
 * The pure helpers here (query parsing, row mapping, summaries) have no imports beyond a
 * type-only SupabaseClient import, so node --test loads them directly. listAudit() is the
 * data-layer function used by GET /api/audit.
 *
 * Fail-closed rule: attribution is read from task_runs.actor_kind / acting_as / actor_ref.
 * A missing or unrecognised actor_kind surfaces as "unknown"; it is never guessed to be
 * "owner". An old run with attribution columns absent therefore shows unknown + null actingAs,
 * even though its owner_id exists.
 */
import type { SupabaseClient } from "@supabase/supabase-js"

/** Keep in sync with ACTOR_KINDS in lib/queue.ts (duplicated so this module stays import-free). */
export const AUDIT_ACTOR_KINDS = ["owner", "agent_token", "connector"] as const
export type AuditActorKind = (typeof AUDIT_ACTOR_KINDS)[number] | "unknown"

export const AUDIT_DEFAULT_LIMIT = 50
export const AUDIT_MAX_LIMIT = 200
const MAX_KIND_LENGTH = 64

export interface AuditEntry {
  id: string
  at: string
  runId: string
  actorKind: AuditActorKind
  actingAs: string | null
  actorRef: string | null
  kind: string
  summary: string
}

export interface AuditQuery {
  limit: number
  kind: string | null
}

/** Maps a raw actor_kind value; anything outside the known kinds is "unknown". */
export function auditActorKind(value: unknown): AuditActorKind {
  return (AUDIT_ACTOR_KINDS as readonly string[]).includes(value as string)
    ? (value as Exclude<AuditActorKind, "unknown">)
    : "unknown"
}

/**
 * Parses `?limit=50&kind=...`. Bad limits fall back to the default; oversized limits clamp;
 * a missing/oversized kind becomes null (no filter).
 */
export function parseAuditQuery(url: string | URL | null | undefined): AuditQuery {
  let params: URLSearchParams | null = null
  try {
    params = new URL(url ?? "http://localhost/audit").searchParams
  } catch {
    params = null
  }
  return {
    limit: normalizeLimit(params?.get("limit") ?? null),
    kind: normalizeKind(params?.get("kind") ?? null),
  }
}

export function normalizeLimit(raw: string | null | undefined): number {
  if (raw === null || raw === undefined || raw.trim() === "") return AUDIT_DEFAULT_LIMIT
  const n = Number(raw)
  if (!Number.isInteger(n) || n < 1) return AUDIT_DEFAULT_LIMIT
  return Math.min(n, AUDIT_MAX_LIMIT)
}

export function normalizeKind(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null
  const trimmed = raw.trim()
  return trimmed && trimmed.length <= MAX_KIND_LENGTH ? trimmed : null
}

function text(value: unknown, max = 120): string {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : ""
}

function actionText(data: Record<string, unknown>): string {
  const id = text(data.actionId, 80)
  const type = text(data.type, 64)
  const amount = typeof data.amountCents === "number" && Number.isFinite(data.amountCents)
    ? `$${(data.amountCents / 100).toFixed(2)}`
    : ""
  return [id || type || "action", amount].filter(Boolean).join(" ")
}

/** Deterministic one-line description of an event for the audit view. Never throws. */
export function summarizeEvent(kind: string, data: Record<string, unknown> | null | undefined): string {
  const d = data && typeof data === "object" ? data : {}
  switch (kind) {
    case "queued":
      return "run queued"
    case "leased":
      return "worker leased the run"
    case "started":
      return "run started"
    case "checkpoint":
      return `checkpoint at step ${typeof d.step === "number" && Number.isFinite(d.step) ? d.step : 0}`
    case "lease_expired":
      return "lease expired and the run was recovered"
    case "budget_refused":
      return "model call refused by the run budget"
    case "approval_requested":
      return `approval requested: ${actionText(d)}`
    case "approval_granted":
      return `approved: ${actionText(d)}`
    case "approval_rejected":
      return `rejected: ${actionText(d)}`
    case "action_executed":
      return `executed: ${actionText(d)}`
    case "action_failed": {
      const reason = text(d.error, 200) || text(d.type, 64) || "unknown error"
      return `action failed: ${reason}`
    }
    case "model_call":
      return "model call"
    case "cost_unknown":
      return "cost could not be determined"
    case "completed":
      return "run completed"
    case "failed": {
      const reason = text(d.error, 200)
      return reason ? `run failed: ${reason}` : "run failed"
    }
    case "cancelled": {
      const reason = text(d.reason, 200)
      return reason ? `run cancelled: ${reason}` : "run cancelled"
    }
    default:
      return kind ? `event ${text(kind, MAX_KIND_LENGTH)}` : "event"
  }
}

/**
 * Maps a joined row (`task_run_events` + embedded `task_runs`) to the audit view.
 * Null/missing attribution never becomes a person: actorKind comes only from actor_kind.
 */
export function auditEntryFromRow(row: Record<string, unknown>): AuditEntry {
  const run = (row.task_runs && typeof row.task_runs === "object" ? row.task_runs : null) as
    | Record<string, unknown>
    | null
  return {
    id: String(row.id ?? ""),
    at: String(row.created_at ?? ""),
    runId: String(row.run_id ?? ""),
    actorKind: auditActorKind(run?.actor_kind),
    actingAs: typeof run?.acting_as === "string" && run.acting_as ? run.acting_as : null,
    actorRef: typeof run?.actor_ref === "string" && run.actor_ref ? run.actor_ref : null,
    kind: String(row.kind ?? ""),
    summary: summarizeEvent(String(row.kind ?? ""), row.data as Record<string, unknown> | null),
  }
}

/**
 * Events joined to their run's attribution, newest first. Owner-gated by the caller:
 * RLS scopes both tables to the signed-in owner's workspace.
 */
export async function listAudit(client: SupabaseClient, query: AuditQuery): Promise<AuditEntry[]> {
  let request = client
    .from("task_run_events")
    .select("id, created_at, run_id, kind, data, task_runs(actor_kind, acting_as, actor_ref)")
    .order("created_at", { ascending: false })
    .limit(query.limit)
  if (query.kind) request = request.eq("kind", query.kind)
  const { data, error } = await request
  if (error) throw new Error(`audit: ${error.message}`)
  return ((data ?? []) as Record<string, unknown>[]).map(auditEntryFromRow)
}
