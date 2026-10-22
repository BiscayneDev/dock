/**
 * Approval card data (assistant thread). Pure functions only: no I/O and no `@/` imports, so the node tests
 * can load this file directly. The card reads the approval_requested and decision events that the worker
 * writes (lib/worker.ts, lib/queue.ts). Nothing here moves money: Approve only lets the gated run continue.
 */

/** Approvals whose estimated cost is above this need a second click that shows the amount. */
export const APPROVAL_CONFIRM_CENTS = 500

/** Text shown wherever a field is missing. The card never guesses a value. */
export const UNKNOWN = "unknown"

export interface ApprovalRunInput {
  id: string
  status: string
  conversationId: string | null
  projectId: string | null
  model: string | null
  budgetCents: number
  payload: Record<string, unknown>
}

export interface ApprovalEventInput {
  runId: string
  kind: string
  data: Record<string, unknown>
  createdAt: string
}

export type ApprovalStatus = "pending" | "approved" | "rejected" | "closed"

export interface ApprovalCardView {
  runId: string
  actionId: string
  status: ApprovalStatus
  statusLabel: string
  /** Plain-language proposal from the run. "unknown" when the run gave none. */
  proposal: string
  /** Exact target (URL, recipient, or destination). "unknown" when absent. */
  target: string
  model: string
  modelReason: string
  estimatedCents: number | null
  estimatedLabel: string
  budgetLabel: string
  projectName: string
  /**
   * What the card renders in the preview slot: an https URL while the stored signed URL is fresh, else the
   * owner's preview route (which returns a fresh signed URL). Null means 'No preview yet'.
   */
  screenshotUrl: string | null
  /** Raw reason code when there is no preview (the card maps it to words). Null otherwise. */
  previewReason: string | null
  /** True when the estimate is above APPROVAL_CONFIRM_CENTS: Approve needs a second click. */
  requiresConfirm: boolean
  decidedAt: string | null
  canDecide: boolean
  footer: string
}

export const APPROVAL_FOOTER = "Approving lets the agent continue. Money moves only through the payment step."

export function formatCents(cents: number | null | undefined): string {
  if (typeof cents !== "number" || !Number.isFinite(cents) || cents < 0) return UNKNOWN
  return `$${(Math.round(cents) / 100).toFixed(2)}`
}

function text(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null
  const t = value.trim()
  return t.length === 0 ? null : t.slice(0, max)
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

/** Only https URLs are shown as a preview. Anything else falls back to the 'No preview yet' state. */
export function safeScreenshotUrl(value: unknown): string | null {
  if (typeof value !== "string") return null
  try {
    const u = new URL(value)
    return u.protocol === "https:" ? u.toString() : null
  } catch {
    return null
  }
}

/**
 * Preview slot for one approval. A stored signed URL is used only until its expiry. After that (or when the
 * stored URL is missing) the card asks the owner's preview route, which signs a fresh URL on each request.
 */
export function previewFields(
  runId: string,
  d: Record<string, unknown>,
  now: number,
): { screenshotUrl: string | null; previewReason: string | null } {
  const stored = safeScreenshotUrl(d.screenshotUrl)
  const expires = typeof d.screenshotExpiresAt === "string" ? Date.parse(d.screenshotExpiresAt) : NaN
  const hasPath = typeof d.screenshotPath === "string" && d.screenshotPath.length > 0
  const storedFresh = stored !== null && Number.isFinite(expires) && expires > now
  let screenshotUrl: string | null = null
  if (storedFresh) screenshotUrl = stored
  else if (hasPath) screenshotUrl = `/api/approvals/${encodeURIComponent(runId)}/preview`
  const reason = typeof d.previewFailed === "string" && d.previewFailed.length > 0 ? d.previewFailed.slice(0, 40) : null
  return { screenshotUrl, previewReason: screenshotUrl ? null : reason ?? null }
}

const STATUS_LABEL: Record<ApprovalStatus, string> = {
  pending: "Waiting for your decision",
  approved: "Approved",
  rejected: "Rejected",
  closed: "Closed without a decision",
}

/**
 * One card per approval request on the given runs, newest first. Only runs for `conversationId` are returned.
 * A request is pending while its run is awaiting_approval and no grant or rejection exists for its action.
 */
export function buildApprovalCards(
  runs: ApprovalRunInput[],
  events: ApprovalEventInput[],
  conversationId: string,
  projectNames: Record<string, string> = {},
  canDecideRun: (run: ApprovalRunInput) => boolean = () => true,
  now: number = Date.now(),
): ApprovalCardView[] {
  const cards: ApprovalCardView[] = []
  // Runs arrive newest first, so the cards do too.
  for (const run of runs) {
    if (run.conversationId !== conversationId) continue
    const runEvents = events.filter((e) => e.runId === run.id)
    const requested = [...runEvents].reverse().find((e) => e.kind === "approval_requested")
    if (!requested) continue
    const actionId = String(requested.data.actionId ?? "")
    const decision = runEvents.find(
      (e) =>
        (e.kind === "approval_granted" || e.kind === "approval_rejected") &&
        e.data.actionId === requested.data.actionId,
    )

    let status: ApprovalStatus
    if (decision?.kind === "approval_granted") status = "approved"
    else if (decision?.kind === "approval_rejected") status = "rejected"
    else if (run.status === "awaiting_approval") status = "pending"
    else status = "closed"

    const d = requested.data
    const estimatedCents = num(d.estimatedCents) ?? num(d.amountCents)
    const budgetCents = num(d.budgetCents) ?? (Number.isFinite(run.budgetCents) ? run.budgetCents : null)
    const projectId = (typeof d.projectId === "string" ? d.projectId : null) ?? run.projectId
    const model = text(d.model, 200) ?? text(run.model, 200)

    cards.push({
      runId: run.id,
      actionId,
      status,
      statusLabel: STATUS_LABEL[status],
      proposal: text(d.proposal, 500) ?? text(d.description, 500) ?? UNKNOWN,
      target: text(d.target, 200) ?? text(d.destination, 200) ?? UNKNOWN,
      model: model ?? UNKNOWN,
      modelReason: text(d.modelReason, 200) ?? text(run.payload.modelReason, 200) ?? UNKNOWN,
      estimatedCents,
      estimatedLabel: formatCents(estimatedCents),
      budgetLabel: formatCents(budgetCents),
      projectName: (projectId && projectNames[projectId]) || UNKNOWN,
      ...previewFields(run.id, d, now),
      requiresConfirm: estimatedCents !== null && estimatedCents > APPROVAL_CONFIRM_CENTS,
      decidedAt: decision ? decision.createdAt : null,
      canDecide: status === "pending" && canDecideRun(run),
      footer: APPROVAL_FOOTER,
    })
  }
  return cards
}

/** Whether a Reject/Approve click should send the request now, or first ask for the second click. */
export function needsSecondClick(card: Pick<ApprovalCardView, "requiresConfirm">, confirmed: boolean): boolean {
  return card.requiresConfirm && !confirmed
}
