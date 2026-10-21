"use client"

import Link from "next/link"
import { useEffect, useMemo, useState } from "react"
import type { Task, Column } from "@/lib/tasks"
import { AGENT_LABELS, PRIORITY_CONFIG } from "@/lib/tasks"

// ── Mapping: real `column` values → Inbox groups ─────────────────────────────
// needs-you : planning (owner refines and approves the Go gate) + in-review (agent finished, owner reviews)
// running   : in-progress (agent activated)
// backlog   : backlog (not started; shown only under "All")
// done      : done
export type InboxGroup = "needs-you" | "running" | "backlog" | "done"
export type InboxFilter = "all" | "needs-you" | "running" | "done"

export const GROUP_OF_COLUMN: Record<Column, InboxGroup> = {
  planning: "needs-you",
  "in-review": "needs-you",
  "in-progress": "running",
  backlog: "backlog",
  done: "done",
}

const GROUP_META: Record<InboxGroup, { label: string; color: string; empty: string }> = {
  "needs-you": { label: "Needs you", color: "#e7c979", empty: "Nothing is waiting on you." },
  running: { label: "Running", color: "#f59e0b", empty: "No agent is running a task right now." },
  backlog: { label: "Backlog", color: "#62657a", empty: "No backlog items." },
  done: { label: "Done", color: "#22c55e", empty: "No finished tasks yet." },
}

const COLUMN_TAG: Record<Column, { label: string; color: string }> = {
  backlog: { label: "Backlog", color: "#62657a" },
  planning: { label: "Planning · needs you", color: "#e7c979" },
  "in-progress": { label: "Running", color: "#f59e0b" },
  "in-review": { label: "Review · needs you", color: "#e7c979" },
  done: { label: "Done", color: "#22c55e" },
}

interface AgentInfo {
  id: string
  name: string
  emoji: string
}

interface ActivityEntry {
  id: string
  taskId: string
  taskTitle: string
  agent: string
  action: string
  summary?: string
  timestamp: string
}

const FILTERS: { id: InboxFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "needs-you", label: "Needs you" },
  { id: "running", label: "Running" },
  { id: "done", label: "Done" },
]

const FILTER_EMPTY: Record<InboxFilter, string> = {
  all: "No tasks yet. Add one on the Board.",
  "needs-you": GROUP_META["needs-you"].empty,
  running: GROUP_META.running.empty,
  done: GROUP_META.done.empty,
}

// Filter → which groups it shows
const FILTER_GROUPS: Record<InboxFilter, InboxGroup[]> = {
  all: ["needs-you", "running", "backlog", "done"],
  "needs-you": ["needs-you"],
  running: ["running"],
  done: ["done"],
}

export function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const pad = (n: number) => String(n).padStart(2, "0")
  if (d > 0) return `${d}d ${pad(h)}h`
  if (h > 0) return `${h}h ${pad(m)}m ${pad(sec)}s`
  return `${m}m ${pad(sec)}s`
}

function relative(iso: string, now: number): string {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return "—"
  const s = Math.max(0, Math.floor((now - t) / 1000))
  if (s < 60) return "just now"
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function fmtTime(iso: string): string {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return "—"
  return new Date(t).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
}

const ACTIVITY_VERB: Record<string, string> = {
  started: "Started",
  reviewed: "Moved to review",
  completed: "Completed",
}

// ── Row ──────────────────────────────────────────────────────────────────────

interface RowProps {
  task: Task
  agent: AgentInfo | undefined
  now: number
  activity: ActivityEntry[] | null
  expanded: boolean
  onToggle: () => void
  onApprove: (task: Task) => Promise<void>
  busy: boolean
  error: string | null
}

const DISABLED_TITLE = "Not wired yet"

function Row({ task, agent, now, activity, expanded, onToggle, onApprove, busy, error }: RowProps) {
  const group = GROUP_OF_COLUMN[task.column]
  const tag = COLUMN_TAG[task.column]
  const pri = PRIORITY_CONFIG[task.priority]
  const isRunning = task.column === "in-progress"
  const canApprove = task.column === "in-review"
  const threadHref = `/conversations?id=task-${task.id}`
  const hasDescription = Boolean(task.description && task.description.trim())
  const taskActivity = (activity ?? []).filter((a) => a.taskId === task.id).slice(0, 6)

  return (
    <li
      className="rounded-xl"
      style={{ background: "var(--surface-1)", border: "1px solid var(--line)" }}
      data-group={group}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="flex w-full flex-col gap-2 p-4 text-left sm:flex-row sm:items-center sm:gap-4"
      >
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className="rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider"
              style={{ color: tag.color, background: `${tag.color}1f`, border: `1px solid ${tag.color}40` }}
            >
              {tag.label}
            </span>
            {task.isDemo && (
              <span className="rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wider" style={{ color: "#f59e0b", border: "1px solid rgba(245,158,11,0.25)" }}>
                Sample
              </span>
            )}
          </div>
          <p className="truncate text-[15px] font-medium" style={{ color: "var(--ink)" }}>
            {task.title}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] sm:shrink-0" style={{ color: "var(--ink-3)" }}>
          <span className="flex items-center gap-1.5" style={{ color: "var(--ink-2)" }}>
            <span aria-hidden>{agent?.emoji ?? "⚪"}</span>
            {agent?.name ?? AGENT_LABELS[task.assignee] ?? "Unassigned"}
          </span>
          <span className="rounded-full px-2 py-0.5 text-[11px]" style={{ color: pri.color, background: `${pri.color}1a` }}>
            {pri.label}
          </span>
          {isRunning ? (
            <span className="tabular-nums" style={{ color: "var(--gold)" }} title="Time since this task was last updated (no start timestamp is stored)">
              {formatElapsed(now - Date.parse(task.updatedAt))} in progress
            </span>
          ) : (
            <span className="tabular-nums" title={fmtTime(task.updatedAt)}>
              updated {relative(task.updatedAt, now)}
            </span>
          )}
        </div>
      </button>

      {expanded && (
        <div className="space-y-4 border-t px-4 pb-4 pt-3" style={{ borderColor: "var(--line)" }}>
          {hasDescription ? (
            <p className="whitespace-pre-wrap text-[13px] leading-relaxed" style={{ color: "var(--ink-2)" }}>
              {task.description}
            </p>
          ) : (
            <p className="text-[13px]" style={{ color: "var(--ink-3)" }}>No description.</p>
          )}

          <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-[12px] sm:max-w-md" style={{ color: "var(--ink-3)" }}>
            <dt>Created</dt>
            <dd className="tabular-nums" style={{ color: "var(--ink-2)" }}>{fmtTime(task.createdAt)}</dd>
            <dt>Last updated</dt>
            <dd className="tabular-nums" style={{ color: "var(--ink-2)" }}>{fmtTime(task.updatedAt)}</dd>
            <dt>Priority</dt>
            <dd style={{ color: "var(--ink-2)" }}>{pri.label}</dd>
          </dl>

          <div>
            <p className="mb-2 text-[11px] uppercase tracking-[0.18em]" style={{ color: "var(--ink-3)" }}>Recent activity</p>
            {activity === null ? (
              <p className="text-[12px]" style={{ color: "var(--ink-3)" }}>Loading…</p>
            ) : taskActivity.length === 0 ? (
              <p className="text-[12px]" style={{ color: "var(--ink-3)" }}>No recorded activity for this task.</p>
            ) : (
              <ol className="space-y-1.5">
                {taskActivity.map((a) => (
                  <li key={a.id} className="flex flex-wrap gap-x-2 text-[12px]" style={{ color: "var(--ink-2)" }}>
                    <span className="tabular-nums" style={{ color: "var(--ink-3)" }}>{fmtTime(a.timestamp)}</span>
                    <span>{ACTIVITY_VERB[a.action] ?? a.action}{a.agent ? ` · ${AGENT_LABELS[a.agent as keyof typeof AGENT_LABELS] ?? a.agent}` : ""}</span>
                    {a.summary && <span style={{ color: "var(--ink-3)" }}>— {a.summary}</span>}
                  </li>
                ))}
              </ol>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={threadHref}
              className="rounded-lg px-3 py-1.5 text-[12px] font-medium transition-colors hover:bg-white/5"
              style={{ border: "1px solid var(--line-strong)", color: "var(--ink)" }}
            >
              Open thread
            </Link>
            <button
              type="button"
              onClick={() => onApprove(task)}
              disabled={!canApprove || busy}
              title={canApprove ? "Mark done (same as dragging to Done on the Board)" : "Approve is only available for tasks in review"}
              className="rounded-lg px-3 py-1.5 text-[12px] font-medium disabled:cursor-not-allowed disabled:opacity-40"
              style={{ background: canApprove ? "var(--gold)" : "var(--surface-3)", color: canApprove ? "#0d0d12" : "var(--ink-2)" }}
            >
              {busy ? "Approving…" : "Approve"}
            </button>
            <button type="button" disabled title={DISABLED_TITLE} className="cursor-not-allowed rounded-lg px-3 py-1.5 text-[12px] opacity-40" style={{ border: "1px solid var(--line-strong)", color: "var(--ink-2)" }}>
              Reject
            </button>
            <button type="button" disabled title={DISABLED_TITLE} className="cursor-not-allowed rounded-lg px-3 py-1.5 text-[12px] opacity-40" style={{ border: "1px solid var(--line-strong)", color: "var(--ink-2)" }}>
              Retry
            </button>
          </div>
          {error && <p className="text-[12px]" style={{ color: "#f87171" }}>{error}</p>}
        </div>
      )}
    </li>
  )
}

// ── Inbox ────────────────────────────────────────────────────────────────────

export default function AgentInbox({ tasks, onRefresh }: { tasks: Task[]; onRefresh: () => Promise<void> | void }) {
  const [filter, setFilter] = useState<InboxFilter>("all")
  const [agents, setAgents] = useState<AgentInfo[]>([])
  const [activity, setActivity] = useState<ActivityEntry[] | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [now, setNow] = useState(() => Date.now())

  // Live clock: tick once a second so running elapsed times advance.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    let cancelled = false
    fetch("/api/agents")
      .then((r) => r.json())
      .then((d: AgentInfo[]) => { if (!cancelled && Array.isArray(d)) setAgents(d) })
      .catch(() => null)
    fetch("/api/activity?limit=200")
      .then((r) => r.json())
      .then((d: ActivityEntry[]) => { if (!cancelled) setActivity(Array.isArray(d) ? d : []) })
      .catch(() => { if (!cancelled) setActivity([]) })
    return () => { cancelled = true }
  }, [])

  const agentById = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents])

  const counts = useMemo(() => {
    const c: Record<InboxFilter, number> = { all: tasks.length, "needs-you": 0, running: 0, done: 0 }
    for (const t of tasks) {
      const g = GROUP_OF_COLUMN[t.column]
      if (g === "needs-you") c["needs-you"]++
      if (g === "running") c.running++
      if (g === "done") c.done++
    }
    return c
  }, [tasks])

  const grouped = useMemo(() => {
    const out: Record<InboxGroup, Task[]> = { "needs-you": [], running: [], backlog: [], done: [] }
    for (const t of tasks) out[GROUP_OF_COLUMN[t.column]].push(t)
    for (const g of Object.keys(out) as InboxGroup[]) {
      out[g].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    }
    return out
  }, [tasks])

  const approve = async (task: Task) => {
    if (task.column !== "in-review") return
    setBusyId(task.id)
    setErrors((e) => { const n = { ...e }; delete n[task.id]; return n })
    try {
      // Same request the Board makes when a card is dragged from In Review to Done.
      const res = await fetch(`/api/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ column: "done" }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      await onRefresh()
    } catch {
      setErrors((e) => ({ ...e, [task.id]: "Could not approve. Nothing changed; try again." }))
    } finally {
      setBusyId(null)
    }
  }

  const visibleGroups = FILTER_GROUPS[filter]
  const visibleCount = visibleGroups.reduce((n, g) => n + grouped[g].length, 0)

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" aria-label="Filter tasks" className="flex flex-wrap gap-1 rounded-lg p-1" style={{ background: "var(--surface-1)", border: "1px solid var(--line)" }}>
          {FILTERS.map((f) => {
            const active = filter === f.id
            return (
              <button
                key={f.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setFilter(f.id)}
                className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] transition-colors"
                style={{ background: active ? "var(--surface-3)" : "transparent", color: active ? "var(--ink)" : "var(--ink-3)" }}
              >
                {f.label}
                <span className="tabular-nums rounded px-1 text-[10px]" style={{ background: "var(--surface-2)", color: "var(--ink-2)" }}>
                  {counts[f.id]}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {visibleCount === 0 ? (
        <div className="rounded-xl px-6 py-12 text-center text-[13px]" style={{ background: "var(--surface-1)", border: "1px dashed var(--line-strong)", color: "var(--ink-3)" }}>
          {FILTER_EMPTY[filter]}
        </div>
      ) : (
        visibleGroups.map((g) => {
          const items = grouped[g]
          if (items.length === 0) return null
          const meta = GROUP_META[g]
          return (
            <section key={g} className="space-y-2">
              <h2 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em]" style={{ color: meta.color }}>
                {meta.label}
                <span className="tabular-nums" style={{ color: "var(--ink-3)" }}>{items.length}</span>
              </h2>
              <ul className="space-y-2">
                {items.map((t) => (
                  <Row
                    key={t.id}
                    task={t}
                    agent={agentById.get(t.assignee)}
                    now={now}
                    activity={activity}
                    expanded={expandedId === t.id}
                    onToggle={() => setExpandedId((cur) => (cur === t.id ? null : t.id))}
                    onApprove={approve}
                    busy={busyId === t.id}
                    error={errors[t.id] ?? null}
                  />
                ))}
              </ul>
            </section>
          )
        })
      )}
    </div>
  )
}
