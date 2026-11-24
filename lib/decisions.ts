/**
 * Decision rules for the one inbox. Pure functions only: no I/O and no runtime imports except
 * node:crypto, so node:test can load this file directly (test/decisions.test.mjs).
 *
 * A decision is one human call bound to an exact artifact version:
 *   { kind, artifactRef, artifactHash, requestedByRun, options, expiresAt, status }
 * The hash is sha256 over canonical JSON with sorted object keys, mirroring the fixed-tuple
 * approach in lib/connector-rules.ts (approvalDetailsHash). Any change to the artifact after
 * the decision was created makes a verdict refused with reason "changed".
 *
 * This module never touches the database. DB wiring lives in app/api/decisions/store.ts.
 */
import { createHash } from "crypto"

export const DECISION_KINDS = ["approval", "review", "question", "blocker"] as const
export type DecisionKind = (typeof DECISION_KINDS)[number]

export const DECISION_STATUSES = [
  "pending",
  "approved",
  "changes_requested",
  "edited_accepted",
  "reassigned",
  "escalated",
  "answered",
  "snoozed",
  "expired",
] as const
export type DecisionStatus = (typeof DECISION_STATUSES)[number]

/** Every way a human can answer a card. "reject" is expressed as request_changes with a reason. */
export const DECISION_VERDICTS = [
  "approve",
  "request_changes",
  "edit_accept",
  "reassign",
  "escalate",
  "answer",
  "snooze",
] as const
export type DecisionVerdict = (typeof DECISION_VERDICTS)[number]

/** Refusal reasons. Order matters: not_pending wins over expired, expired wins over changed. */
export type DecisionRefusal = "not_pending" | "expired" | "changed"

export interface DecisionOption {
  id: string
  label: string
  description?: string
}

/** Shape stored in the decisions table (snake_case columns; the API serializes to camelCase). */
export interface DecisionRecord {
  id: string
  workspaceId: string
  ownerId: string
  kind: DecisionKind
  title: string
  summary: string
  artifactRef: string
  artifactHash: string
  requestedByRun: string | null
  options: DecisionOption[]
  reason: string | null
  status: DecisionStatus
  decidedBy: string | null
  decidedAt: string | null
  expiresAt: string | null
  snoozedUntil: string | null
  producerId: string | null
  createdAt: string
  updatedAt: string
}

/** Default shelf life for a decision that did not ask for one. */
export const DECISION_DEFAULT_TTL_MS = 24 * 60 * 60 * 1000

export const DECISION_TITLE_MAX = 280
export const DECISION_SUMMARY_MAX = 2000
export const DECISION_REASON_MAX = 2000
export const DECISION_OPTIONS_MAX = 8

const KIND_SET: ReadonlySet<string> = new Set(DECISION_KINDS)
const VERDICT_SET: ReadonlySet<string> = new Set(DECISION_VERDICTS)

export function isDecisionKind(value: unknown): value is DecisionKind {
  return typeof value === "string" && KIND_SET.has(value)
}

export function isDecisionStatus(value: unknown): value is DecisionStatus {
  return typeof value === "string" && (DECISION_STATUSES as readonly string[]).includes(value)
}

export function isDecisionVerdict(value: unknown): value is DecisionVerdict {
  return typeof value === "string" && VERDICT_SET.has(value)
}

/** True once a verdict has been recorded. Snoozed decisions can still be decided later. */
export function isDecided(status: string): boolean {
  return (
    status === "approved" ||
    status === "edited_accepted" ||
    status === "answered" ||
    status === "changes_requested" ||
    status === "reassigned" ||
    status === "escalated" ||
    status === "expired"
  )
}

export function isPending(status: string): boolean {
  return status === "pending" || status === "snoozed"
}

/** Canonical JSON: object keys sorted at every depth, arrays keep their order. */
export function canonicalJson(value: unknown): string {
  return stable(value)
}

function stable(value: unknown): string {
  if (value === undefined) return "null"
  if (value === null || typeof value !== "object") {
    const json = JSON.stringify(value)
    return json === undefined ? "null" : json
  }
  if (Array.isArray(value)) return `[${value.map((item) => stable(item)).join(",")}]`
  const record = value as Record<string, unknown>
  const keys = Object.keys(record).filter((k) => record[k] !== undefined).sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stable(record[k])}`).join(",")}}`
}

/** sha256 of the canonical artifact. Same bytes always produce the same hash. */
export function artifactHash(artifact: unknown): string {
  return createHash("sha256").update(stable(artifact), "utf8").digest("hex")
}

/**
 * The artifact a run approval is bound to. Fields mirror lib/connector-rules.ts approvalDetailsHash
 * (actionId, type, amountCents, destination, description) so a Dinghy approval and a Dock approval
 * hash the same details the same way.
 */
export function runApprovalArtifact(input: {
  payload: Record<string, unknown>
  events?: Array<{ kind: string; data: Record<string, unknown> }>
}): Record<string, unknown> | null {
  const requested = [...(input.events ?? [])].reverse().find((e) => e.kind === "approval_requested")
  const source = requested?.data ?? {}
  const proposed = input.payload?.proposedAction
  const action = proposed && typeof proposed === "object" ? (proposed as Record<string, unknown>) : {}
  const text = (v: unknown, max: number): string | null =>
    typeof v === "string" && v.length > 0 ? v.slice(0, max) : null
  const actionId = text(source.actionId, 80) ?? text(action.id, 80)
  const type = text(source.type, 64) ?? text(action.type, 64)
  if (!actionId || !type) return null
  const amountCents =
    typeof source.amountCents === "number" && Number.isFinite(source.amountCents)
      ? source.amountCents
      : typeof action.amountCents === "number" && Number.isFinite(action.amountCents)
        ? action.amountCents
        : null
  return {
    actionId,
    type,
    amountCents,
    destination: text(source.destination, 200) ?? text(action.destination, 200) ?? null,
    description: text(source.description, 500) ?? text(action.description, 500) ?? null,
  }
}

/** Plain-words proposal/title for a run approval. Falls back to "Approval needed". */
export function runApprovalTitle(input: {
  payload: Record<string, unknown>
  events?: Array<{ kind: string; data: Record<string, unknown> }>
}): string {
  const requested = [...(input.events ?? [])].reverse().find((e) => e.kind === "approval_requested")
  const d = requested?.data ?? {}
  const proposal = typeof d.proposal === "string" ? d.proposal.trim() : ""
  if (proposal) return proposal.slice(0, DECISION_TITLE_MAX)
  const description = typeof d.description === "string" ? d.description.trim() : ""
  if (description) return description.slice(0, DECISION_TITLE_MAX)
  const prompt = typeof input.payload?.prompt === "string" ? input.payload.prompt.trim() : ""
  if (prompt) return prompt.slice(0, DECISION_TITLE_MAX)
  return "Approval needed"
}

export function normalizeOptions(value: unknown): DecisionOption[] | null {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) return null
  const out: DecisionOption[] = []
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null
    const o = item as Record<string, unknown>
    const id = typeof o.id === "string" ? o.id.trim() : ""
    const label = typeof o.label === "string" ? o.label.trim() : ""
    if (!id || id.length > 80 || !label || label.length > 120) return null
    const description =
      typeof o.description === "string" && o.description.trim().length > 0
        ? o.description.trim().slice(0, 300)
        : undefined
    out.push({ id, label, ...(description ? { description } : {}) })
  }
  if (out.length > DECISION_OPTIONS_MAX) return null
  return out
}

function parseDate(value: unknown): Date | null {
  if (typeof value !== "string" || value.trim().length === 0) return null
  const t = Date.parse(value)
  return Number.isFinite(t) ? new Date(t) : null
}

export interface DecisionRequest {
  kind: DecisionKind
  title: string
  summary?: string
  artifactRef: string
  /** The artifact itself. Hashed server-side; absent means the ref is all we have. */
  artifact?: unknown
  requestedByRun?: string | null
  producerId?: string | null
  options?: DecisionOption[]
  reason?: string | null
  expiresAt?: string | null
}

export type DecisionRequestResult =
  | { ok: true; value: DecisionRequest & { artifactHash: string; expiresAt: string | null } }
  | { ok: false; error: string }

/**
 * Validates a create payload. Never guesses: a missing kind defaults to "approval" (the most common
 * card), but a missing title or malformed option is a hard error.
 */
export function validateDecisionRequest(input: unknown): DecisionRequestResult {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "body must be an object" }
  }
  const b = input as Record<string, unknown>
  const kind = b.kind === undefined || b.kind === null ? "approval" : b.kind
  if (!isDecisionKind(kind)) return { ok: false, error: "invalid kind" }

  const title = typeof b.title === "string" ? b.title.trim() : ""
  if (!title) return { ok: false, error: "title is required" }
  if (title.length > DECISION_TITLE_MAX) return { ok: false, error: "title is too long" }

  const summary =
    typeof b.summary === "string" && b.summary.trim().length > 0
      ? b.summary.trim().slice(0, DECISION_SUMMARY_MAX)
      : ""

  const artifactRef = typeof b.artifactRef === "string" ? b.artifactRef.trim().slice(0, 500) : ""
  const hasArtifact = b.artifact !== undefined && b.artifact !== null
  if (!hasArtifact && !artifactRef) return { ok: false, error: "artifactRef is required" }

  const options = normalizeOptions(b.options)
  if (options === null) return { ok: false, error: "options must be a list of {id,label}" }

  let expiresAt: string | null = null
  if (b.expiresAt !== undefined && b.expiresAt !== null && String(b.expiresAt).trim() !== "") {
    const parsed = parseDate(b.expiresAt)
    if (!parsed) return { ok: false, error: "expiresAt is not a valid date" }
    expiresAt = parsed.toISOString()
  }

  let reason: string | null = null
  if (typeof b.reason === "string" && b.reason.trim().length > 0) {
    reason = b.reason.trim().slice(0, DECISION_REASON_MAX)
  }

  const requestedByRun = typeof b.requestedByRun === "string" && b.requestedByRun ? b.requestedByRun : null
  const producerId = typeof b.producerId === "string" && b.producerId ? b.producerId : null

  const artifact = hasArtifact ? b.artifact : { artifactRef }
  return {
    ok: true,
    value: {
      kind,
      title,
      summary,
      artifactRef,
      artifact,
      requestedByRun,
      producerId,
      options,
      reason,
      expiresAt,
      artifactHash: artifactHash(artifact),
    },
  }
}

/** Status a verdict moves a pending decision to. */
export function verdictStatus(verdict: DecisionVerdict): DecisionStatus {
  switch (verdict) {
    case "approve":
      return "approved"
    case "request_changes":
      return "changes_requested"
    case "edit_accept":
      return "edited_accepted"
    case "reassign":
      return "reassigned"
    case "escalate":
      return "escalated"
    case "answer":
      return "answered"
    case "snooze":
      return "snoozed"
  }
}

export type VerdictPlan =
  | { ok: true; verdict: DecisionVerdict; status: DecisionStatus; reason: string | null; note: string | null }
  | { ok: false; error: string }

/**
 * Validates a verdict body. A reason is required for changes_requested (the producer cannot act on
 * "no"), and an answer requires the answer text. Notes are optional everywhere else.
 */
export function planVerdict(input: {
  verdict: unknown
  kind?: string
  reason?: unknown
  note?: unknown
}): VerdictPlan {
  if (!isDecisionVerdict(input.verdict)) return { ok: false, error: "invalid verdict" }
  const verdict = input.verdict

  let reason: string | null = null
  if (typeof input.reason === "string" && input.reason.trim().length > 0) {
    reason = input.reason.trim().slice(0, DECISION_REASON_MAX)
  }
  let note: string | null = null
  if (typeof input.note === "string" && input.note.trim().length > 0) {
    note = input.note.trim().slice(0, DECISION_REASON_MAX)
  }

  if (verdict === "request_changes" && !reason) {
    return { ok: false, error: "a reason is required when requesting changes" }
  }
  if (verdict === "answer" && !note) {
    return { ok: false, error: "an answer is required" }
  }
  return { ok: true, verdict, status: verdictStatus(verdict), reason, note }
}

/**
 * Whether a decision may be decided now. Order matters: a decided/snoozed-closed card is
 * "not_pending" even when its expiry has also passed. Returns null when the verdict may proceed.
 */
export function decisionRefusal(input: {
  status: string
  expiresAt: string | Date | null
  now: number
  storedHash: string
  expectedHash?: string | null
  currentHash?: string | null
}): DecisionRefusal | null {
  if (!isPending(input.status)) return "not_pending"
  if (input.expiresAt) {
    const t = typeof input.expiresAt === "string" ? Date.parse(input.expiresAt) : input.expiresAt.getTime()
    if (Number.isFinite(t) && t <= input.now) return "expired"
  }
  if (input.expectedHash && input.expectedHash !== input.storedHash) return "changed"
  if (input.currentHash && input.currentHash !== input.storedHash) return "changed"
  return null
}

/** Reviewer != producer: a run's producer cannot approve its own work. */
export function reviewerIsProducer(reviewerId: string | null | undefined, producerId: string | null | undefined): boolean {
  if (!reviewerId || !producerId) return false
  return reviewerId === producerId
}

/** True when an expires_at instant has passed. Null expiry never expires. */
export function isExpired(expiresAt: string | null | undefined, now: number): boolean {
  if (!expiresAt) return false
  const t = Date.parse(expiresAt)
  return Number.isFinite(t) && t <= now
}
