/**
 * Inbox aggregation rules. Pure functions only: no I/O and no imports, so node:test can load this
 * file directly (test/inbox-query.test.mjs). The API route loads decisions, alerts, runs, briefs and
 * messages as plain rows and calls queryInbox(); this module decides what a card is and how the
 * queue is filtered and sorted. It never talks to Supabase or the filesystem.
 *
 * Groups mirror the inbox tabs:
 *   needs-you : waiting on a human verdict right now
 *   running   : work is in flight (including changes_requested / escalated follow-up)
 *   done      : resolved, acknowledged or expired
 */

export type InboxFilter = "all" | "needs-you" | "running" | "done"
export type InboxGroup = "needs-you" | "running" | "done"
export type InboxItemType = "decision" | "alert" | "run" | "brief" | "message"

export const INBOX_FILTERS: readonly InboxFilter[] = ["all", "needs-you", "running", "done"]

export interface InboxItem {
  key: string
  type: InboxItemType
  kind: string
  status: string
  title: string
  summary: string
  artifactRef: string | null
  artifactHash: string | null
  runId: string | null
  ownerId: string | null
  workspaceId: string | null
  group: InboxGroup
  needsHuman: boolean
  createdAt: string
  updatedAt: string
  raw: Record<string, unknown>
}

/** Loose row shapes: both DB snake_case and API camelCase are accepted. */
export interface DecisionInput {
  id?: string
  kind?: string
  status?: string
  title?: string
  summary?: string
  artifact_ref?: string | null
  artifactRef?: string | null
  artifact_hash?: string | null
  artifactHash?: string | null
  requested_by_run?: string | null
  requestedByRun?: string | null
  reason?: string | null
  owner_id?: string | null
  workspace_id?: string | null
  created_at?: string
  createdAt?: string
  updated_at?: string
  updatedAt?: string
  verdicts?: unknown[]
  [key: string]: unknown
}

export interface AlertInput {
  id?: string
  type?: string
  severity?: string
  status?: string
  title?: string
  summary?: string
  runId?: string | null
  taskId?: string | null
  conversationId?: string | null
  created_at?: string
  createdAt?: string
  updated_at?: string
  updatedAt?: string
  [key: string]: unknown
}

export interface RunInput {
  id?: string
  status?: string
  agentKey?: string | null
  agent_key?: string | null
  agentId?: string | null
  projectId?: string | null
  target?: string | null
  budgetCents?: number | null
  spentCents?: number | null
  error?: string | null
  output?: string | null
  created_at?: string
  createdAt?: string
  updated_at?: string
  updatedAt?: string
  payload?: Record<string, unknown> | null
  [key: string]: unknown
}

export interface BriefInput {
  id?: string
  state?: string
  goal?: string
  context?: string
  agentKey?: string | null
  agent_key?: string | null
  riskFlags?: string[] | null
  budgetCents?: number | null
  runId?: string | null
  run_id?: string | null
  project_id?: string | null
  created_at?: string
  createdAt?: string
  updated_at?: string
  updatedAt?: string
  [key: string]: unknown
}

export interface MessageInput {
  id?: string
  role?: string
  content?: string
  agent?: string | null
  conversationId?: string | null
  unread?: boolean
  created_at?: string
  createdAt?: string
  updated_at?: string
  updatedAt?: string
  [key: string]: unknown
}

export interface InboxInput {
  decisions?: DecisionInput[]
  alerts?: AlertInput[]
  runs?: RunInput[]
  briefs?: BriefInput[]
  messages?: MessageInput[]
}

export interface InboxCounts {
  all: number
  "needs-you": number
  running: number
  done: number
}

function str(value: unknown): string {
  return typeof value === "string" ? value : ""
}

function nullable(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null
}

function timestamp(row: Record<string, unknown>, camel: string, snake: string): string {
  const v = row[camel] ?? row[snake]
  return typeof v === "string" && v.length > 0 ? v : new Date(0).toISOString()
}

const DECISION_GROUP: Record<string, InboxGroup> = {
  pending: "needs-you",
  approved: "done",
  edited_accepted: "done",
  answered: "done",
  expired: "done",
  snoozed: "done",
  changes_requested: "running",
  reassigned: "running",
  escalated: "running",
}

const RUN_GROUP: Record<string, InboxGroup> = {
  queued: "running",
  leased: "running",
  running: "running",
  awaiting_approval: "needs-you",
  succeeded: "done",
  failed: "done",
  cancelled: "done",
}

const BRIEF_GROUP: Record<string, InboxGroup> = {
  proposed: "needs-you",
  approved: "running",
  running: "running",
  succeeded: "done",
  failed: "done",
  cancelled: "done",
}

function decisionItem(d: DecisionInput): InboxItem {
  const status = str(d.status) || "pending"
  const group = DECISION_GROUP[status] ?? "needs-you"
  const runId = nullable(d.requested_by_run) ?? nullable(d.requestedByRun)
  return {
    key: `decision:${str(d.id)}`,
    type: "decision",
    kind: str(d.kind) || "approval",
    status,
    title: str(d.title) || "Decision needed",
    summary: str(d.summary) || str(d.reason),
    artifactRef: nullable(d.artifact_ref) ?? nullable(d.artifactRef),
    artifactHash: nullable(d.artifact_hash) ?? nullable(d.artifactHash),
    runId,
    ownerId: nullable(d.owner_id),
    workspaceId: nullable(d.workspace_id),
    group,
    needsHuman: status === "pending",
    createdAt: timestamp(d as Record<string, unknown>, "createdAt", "created_at"),
    updatedAt: timestamp(d as Record<string, unknown>, "updatedAt", "updated_at"),
    raw: d as Record<string, unknown>,
  }
}

function alertItem(a: AlertInput): InboxItem {
  const status = str(a.status) || "open"
  const group: InboxGroup = status === "open" ? "needs-you" : "done"
  return {
    key: `alert:${str(a.id)}`,
    type: "alert",
    kind: str(a.type) || "alert",
    status,
    title: str(a.title) || "Alert",
    summary: str(a.summary),
    artifactRef: nullable(a.runId) ? `run:${a.runId}` : nullable(a.taskId) ? `task:${a.taskId}` : null,
    artifactHash: null,
    runId: nullable(a.runId),
    ownerId: null,
    workspaceId: null,
    group,
    needsHuman: status === "open",
    createdAt: timestamp(a as Record<string, unknown>, "createdAt", "created_at"),
    updatedAt: timestamp(a as Record<string, unknown>, "updatedAt", "updated_at"),
    raw: a as Record<string, unknown>,
  }
}

function runItem(r: RunInput): InboxItem {
  const status = str(r.status) || "queued"
  const group = RUN_GROUP[status] ?? "running"
  const error = nullable(r.error)
  const output = nullable(r.output)
  return {
    key: `run:${str(r.id)}`,
    type: "run",
    kind: str(r.agentKey) || str(r.agent_key) || str(r.target) || "run",
    status,
    title:
      status === "awaiting_approval"
        ? "Approval needed before this run continues"
        : status === "failed"
          ? error || "Run failed"
          : output || `${status}`,
    summary: error ?? output ?? "",
    artifactRef: str(r.id) ? `run:${str(r.id)}` : null,
    artifactHash: null,
    runId: nullable(r.id),
    ownerId: null,
    workspaceId: null,
    group,
    needsHuman: status === "awaiting_approval",
    createdAt: timestamp(r as Record<string, unknown>, "createdAt", "created_at"),
    updatedAt: timestamp(r as Record<string, unknown>, "updatedAt", "updated_at"),
    raw: r as Record<string, unknown>,
  }
}

function briefItem(b: BriefInput): InboxItem {
  const state = str(b.state) || "proposed"
  const group = BRIEF_GROUP[state] ?? "needs-you"
  return {
    key: `brief:${str(b.id)}`,
    type: "brief",
    kind: str(b.agentKey) || str(b.agent_key) || "brief",
    status: state,
    title: str(b.goal) || "Project brief",
    summary: str(b.context),
    artifactRef: str(b.id) ? `brief:${str(b.id)}` : null,
    artifactHash: null,
    runId: nullable(b.runId) ?? nullable(b.run_id),
    ownerId: null,
    workspaceId: null,
    group,
    needsHuman: state === "proposed",
    createdAt: timestamp(b as Record<string, unknown>, "createdAt", "created_at"),
    updatedAt: timestamp(b as Record<string, unknown>, "updatedAt", "updated_at"),
    raw: b as Record<string, unknown>,
  }
}

function messageItem(m: MessageInput): InboxItem {
  // Messages are advisory: an explicitly unread agent/assistant message waits for the human, the rest
  // are recent activity and land in Done.
  const role = str(m.role)
  const unread = m.unread === true || (role !== "user" && m.unread === undefined)
  const group: InboxGroup = unread ? "needs-you" : "done"
  return {
    key: `message:${str(m.id)}`,
    type: "message",
    kind: str(m.agent) || role || "message",
    status: unread ? "unread" : "read",
    title: role === "user" ? "You said" : str(m.agent) || "Agent update",
    summary: str(m.content),
    artifactRef: nullable(m.conversationId) ? `conversation:${m.conversationId}` : null,
    artifactHash: null,
    runId: nullable((m as Record<string, unknown>).runId),
    ownerId: null,
    workspaceId: null,
    group,
    needsHuman: unread,
    createdAt: timestamp(m as Record<string, unknown>, "createdAt", "created_at"),
    updatedAt: timestamp(m as Record<string, unknown>, "updatedAt", "updated_at"),
    raw: m as Record<string, unknown>,
  }
}

/** Flattens every source into one queue. Order is stable: newest updated first after sorting. */
export function toInboxItems(input: InboxInput): InboxItem[] {
  const items: InboxItem[] = []
  for (const d of input.decisions ?? []) items.push(decisionItem(d))
  for (const a of input.alerts ?? []) items.push(alertItem(a))
  for (const r of input.runs ?? []) items.push(runItem(r))
  for (const b of input.briefs ?? []) items.push(briefItem(b))
  for (const m of input.messages ?? []) items.push(messageItem(m))
  return sortInbox(items)
}

/** Newest activity first; pending human work wins ties so the queue never buries a verdict. */
export function sortInbox(items: InboxItem[]): InboxItem[] {
  const rank = (g: InboxGroup): number => (g === "needs-you" ? 0 : g === "running" ? 1 : 2)
  return items.slice().sort((a, b) => {
    const t = Date.parse(b.updatedAt) - Date.parse(a.updatedAt)
    if (t !== 0) return t
    const r = rank(a.group) - rank(b.group)
    if (r !== 0) return r
    const c = Date.parse(b.createdAt) - Date.parse(a.createdAt)
    if (c !== 0) return c
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0
  })
}

export function filterInbox(items: InboxItem[], filter: InboxFilter): InboxItem[] {
  if (filter === "all") return items.slice()
  return items.filter((i) => i.group === filter)
}

export function searchInbox(items: InboxItem[], query: string): InboxItem[] {
  const q = query.trim().toLowerCase()
  if (!q) return items
  return items.filter((i) =>
    [i.title, i.summary, i.artifactRef ?? "", i.kind, i.status, i.raw?.goal, i.raw?.content]
      .filter((v): v is string => typeof v === "string")
      .some((v) => v.toLowerCase().includes(q)),
  )
}

export function inboxCounts(items: InboxItem[]): InboxCounts {
  const counts: InboxCounts = { all: items.length, "needs-you": 0, running: 0, done: 0 }
  for (const item of items) counts[item.group] += 1
  return counts
}

export function queryInbox(
  input: InboxInput,
  options: { filter?: InboxFilter; search?: string; limit?: number } = {},
): { items: InboxItem[]; counts: InboxCounts; filter: InboxFilter } {
  const all = toInboxItems(input)
  const filter: InboxFilter =
    options.filter && INBOX_FILTERS.includes(options.filter) ? options.filter : "all"
  const searched = searchInbox(all, options.search ?? "")
  const filtered = filterInbox(searched, filter)
  const limit = typeof options.limit === "number" && options.limit > 0 ? options.limit : 0
  return {
    items: limit > 0 ? filtered.slice(0, limit) : filtered,
    counts: inboxCounts(all),
    filter,
  }
}
