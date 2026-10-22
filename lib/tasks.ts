export type Priority = "high" | "medium" | "low"
export type Column = "backlog" | "planning" | "in-progress" | "in-review" | "done"
export type Agent = string

export interface Task {
  id: string
  title: string
  description?: string
  enrichedTitle?: string
  enrichedDescription?: string
  acceptanceCriteria?: string[]
  implementationPlan?: string[]
  risks?: string[]
  /** Buoy quoted plan attached to this brief (quote IS the approval UX). */
  toolNeeds?: string[]
  quote?: {
    quoteId: string
    totalUsd: number
    steps: Array<{ name: string; serviceId: string; amountUsd: number; serviceName?: string; outcome?: string; category?: string }>
    expiresAt: string
  }
  jobId?: string
  jobStatus?: string
  column: Column
  priority: Priority
  assignee: Agent
  tags: string[]
  goalId?: string
  isDemo?: boolean
  createdAt: string
  updatedAt: string
}

export interface UpdateTaskInput {
  title?: string
  description?: string
  enrichedTitle?: string
  enrichedDescription?: string
  acceptanceCriteria?: string[]
  implementationPlan?: string[]
  risks?: string[]
  column?: Column
  priority?: Priority
  assignee?: Agent
  tags?: string[]
  goalId?: string | null
}

export const COLUMNS: { id: Column; label: string }[] = [
  { id: "backlog", label: "Backlog" },
  { id: "planning", label: "Planning" },
  { id: "in-progress", label: "In Progress" },
  { id: "in-review", label: "In Review" },
  { id: "done", label: "Done" },
]

import { CHIEF_ROLE_LABEL, CHIEF_RUNTIME_KEY } from "@/lib/chief-key"

const SPECIALIST_EMOJI: Record<string, string> = {
  scout: "🔭",
  "deal-flow": "🤝",
  builder: "⚡",
  baron: "🏦",
  unassigned: "⚪",
}

const SPECIALIST_LABELS: Record<string, string> = {
  scout: "Scout",
  "deal-flow": "Deal Flow",
  builder: "Builder",
  baron: "Baron",
  unassigned: "Unassigned",
}

/** Emoji for an agent key. The chief gets the neutral compass; unknown keys get a robot. */
export function agentEmoji(key: string): string {
  if (key === CHIEF_RUNTIME_KEY) return "🧭"
  return SPECIALIST_EMOJI[key] ?? "🤖"
}

/** Label for an agent key. Pages with a live roster should prefer the stored display name. */
export function agentLabel(key: string): string {
  if (key === CHIEF_RUNTIME_KEY) return CHIEF_ROLE_LABEL
  return SPECIALIST_LABELS[key] ?? key
}

export const AGENT_EMOJI: Record<string, string> = new Proxy({} as Record<string, string>, {
  get: (_t, key: string) => agentEmoji(key),
})

export const AGENT_LABELS: Record<string, string> = {
  ...SPECIALIST_LABELS,
  [CHIEF_RUNTIME_KEY]: CHIEF_ROLE_LABEL,
}

export const PRIORITY_CONFIG: Record<Priority, { color: string; border: string; label: string }> = {
  high: { color: "#ef4444", border: "#ef4444", label: "High" },
  medium: { color: "#f59e0b", border: "#f59e0b", label: "Medium" },
  low: { color: "#22c55e", border: "#22c55e", label: "Low" },
}
