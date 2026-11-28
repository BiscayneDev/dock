"use client"

import { useEffect, useState, useCallback } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import TasksBoard from "@/app/tasks/TasksBoard"
import {
  LaunchCard,
  clearLaunchArrival,
  consumeLaunchArrival,
  type LaunchArrival,
} from "@/components/onboarding/LaunchCard"

// ── Types ──────────────────────────────────────────────────────────────────────

interface Session {
  key?: string
  id?: string
  label?: string
  model?: string
  status?: string
  startedAt?: string
  created_at?: string
}

interface Task {
  id: string
  title: string
  column: string
  assignee: string
  priority: string
  description?: string
}

interface Repo {
  name: string
  description: string | null
  url: string
  updatedAt: string
  latestRun: { status: string; conclusion: string | null; url: string } | null
  openPRs: { number: number; title: string; url: string }[]
}

interface IntelReport {
  generatedAt: string | null
  summary?: string
  headline?: string
}

interface Goal {
  id: string
  title: string
  description?: string
  status: "active" | "completed" | "paused"
  priority: "high" | "medium" | "low"
  assignedTo?: string
  taskIds?: string[]
  progress?: { total: number; done: number; percent: number }
}

interface ActivityEntry {
  id: string
  taskId: string
  taskTitle: string
  agent: string
  action: "started" | "completed" | "reviewed"
  summary?: string
  timestamp: string
}

interface ConversationSummary {
  id: string
  title: string
  agent: string
  status: "active" | "completed" | "failed" | "paused"
  createdAt: string
  updatedAt: string
  lastMessageAt: string
  latestPreview: string
  project?: string
  taskId?: string
  messageCount: number
  runCount: number
}

interface EmailEntry {
  id: string
  from: string
  fromName: string
  subject: string
  snippet: string
  date: string
}

interface CalendarEvent {
  id: string
  title: string
  start: string
  end: string | null
  location: string | null
  allDay: boolean
}

// ── Constants ──────────────────────────────────────────────────────────────────

const PINNED = ["shipyard", "mission-control", "superteam-miami", "arken"]

const AGENT_DEFS = [
  { name: "Chief of staff", emoji: "🧭", accent: "#7c3aed", keys: ["main"] },
  { name: "Scout", emoji: "🔭", accent: "#06b6d4", keys: ["scout"] },
  { name: "Deal Flow", emoji: "🤝", accent: "#f59e0b", keys: ["deal-flow", "dealflow"] },
  { name: "Builder", emoji: "⚡", accent: "#10b981", keys: ["builder", "subagent"] },
  { name: "Baron", emoji: "🏦", accent: "#ec4899", keys: ["wallet", "baron"] },
] as const

const TASK_COLUMNS = [
  { id: "backlog", label: "Backlog" },
  { id: "planning", label: "Planning" },
  { id: "in-progress", label: "In Progress" },
  { id: "in-review", label: "In Review" },
  { id: "done", label: "Done" },
] as const

const AGENT_EMOJI_MAP: Record<string, string> = {
  scout: "🔭",
  "deal-flow": "🤝",
  builder: "⚡",
  baron: "🏦",
  unassigned: "⚪",
}

const PRIORITY_COLOR: Record<string, string> = {
  high: "#ef4444",
  medium: "#f59e0b",
  low: "#22c55e",
}

const ACTION_COLOR_MAP: Record<string, string> = {
  started: "#3178c6",
  reviewed: "#f59e0b",
  completed: "#22c55e",
}

const ACTION_LABEL_MAP: Record<string, string> = {
  started: "started",
  reviewed: "reviewed",
  completed: "completed",
}

/** Work rail: every capability that used to be a top-level page. One click from the brief. */
const WORK_RAIL = [
  { href: "/tasks", label: "Missions board", hint: "Kanban · drag to activate", emoji: "🗂" },
  { href: "/activity", label: "Runs & activity", hint: "Run trace + event timeline", emoji: "⚡" },
  { href: "/projects", label: "Projects", hint: "Repos · CI · open PRs", emoji: "◈" },
  { href: "/treasury", label: "Treasury", hint: "Wallets · balances", emoji: "🏦" },
  { href: "/intel", label: "Intel", hint: "Scout research reports", emoji: "🔭" },
  { href: "/calendar", label: "Calendar", hint: "Google Calendar events", emoji: "📅" },
  { href: "/company", label: "Company", hint: "Goals · budgets · org", emoji: "🧭" },
  { href: "/conversations", label: "Conversations", hint: "Threads + transcripts", emoji: "💬" },
  { href: "/messages", label: "Messages", hint: "Agent messages + delegations", emoji: "✉️" },
  { href: "/alerts", label: "Alerts", hint: "Failed-run inbox", emoji: "🚨" },
  { href: "/schedules", label: "Schedules", hint: "Scheduled jobs", emoji: "⏱" },
  { href: "/memory", label: "Knowledge", hint: "Memory · skills · docs", emoji: "🧠" },
  { href: "/costs", label: "Costs", hint: "Tokens · spend", emoji: "📈" },
] as const

// ── Helpers ───────────────────────────────────────────────────────────────────

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  const hrs = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins}m ago`
  if (hrs < 24) return `${hrs}h ago`
  if (days < 30) return `${days}d ago`
  return `${Math.floor(days / 30)}mo ago`
}

function isSessionActive(sessions: Session[], keys: readonly string[]): boolean {
  return sessions.some((s) => {
    const k = (s.key ?? s.id ?? s.label ?? "").toLowerCase()
    return keys.some((key) => k.includes(key))
  })
}

function ciColor(run: Repo["latestRun"]): string {
  if (!run) return "#71717a"
  if (run.status === "in_progress" || run.status === "queued") return "#f59e0b"
  if (run.conclusion === "success") return "#22c55e"
  return "#ef4444"
}

function ciLabel(run: Repo["latestRun"]): string {
  if (!run) return "No CI"
  if (run.status === "in_progress" || run.status === "queued") return "Running"
  if (run.conclusion === "success") return "Passing"
  return "Failing"
}

function formatTime(iso: string, allDay: boolean): string {
  if (allDay) return "All day"
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })
}

function formatDateLabel(iso: string): string {
  const d = new Date(iso.includes("T") ? iso : iso + "T00:00:00")
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const target = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const diff = Math.round((target.getTime() - today.getTime()) / 86400000)
  if (diff === 0) return "Today"
  if (diff === 1) return "Tomorrow"
  if (diff > 0 && diff < 7) return d.toLocaleDateString("en-US", { weekday: "long" })
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })
}

function getFormattedDate(): string {
  return new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })
}

function hotRiskRepo(repos: Repo[]): Repo | undefined {
  return repos.find((repo) => repo.latestRun?.status === "in_progress" || repo.latestRun?.conclusion !== "success")
}

function hotRiskLabel(repos: Repo[]): string {
  const hot = hotRiskRepo(repos)
  if (!hot) return "No live risk"
  return hot.latestRun?.conclusion === "failure" ? `${hot.name} failing` : `${hot.name} active`
}

function formatEventWindow(ev: CalendarEvent): string {
  return ev.end ? `${formatTime(ev.start, ev.allDay)} – ${formatTime(ev.end, false)}` : formatTime(ev.start, ev.allDay)
}

// ── Work surface ──────────────────────────────────────────────────────────────

export default function WorkClient() {
  const router = useRouter()
  const [sessions, setSessions] = useState<Session[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [repos, setRepos] = useState<Repo[]>([])
  const [intel, setIntel] = useState<IntelReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [goals, setGoals] = useState<Goal[]>([])
  const [recentActivity, setRecentActivity] = useState<ActivityEntry[]>([])
  const [conversations, setConversations] = useState<ConversationSummary[]>([])
  const [emails, setEmails] = useState<EmailEntry[]>([])
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [demoMode, setDemoMode] = useState(false)
  const [arrival, setArrival] = useState<LaunchArrival | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch("/api/workspace", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<{ workspaceId?: string; building?: string; mainGoal?: string }>) : null))
      .then((ws) => {
        if (cancelled || !ws?.workspaceId) return
        const next = consumeLaunchArrival(ws.workspaceId, ws.building || ws.mainGoal || "")
        if (next) setArrival(next)
      })
      .catch(() => null)
    return () => {
      cancelled = true
    }
  }, [])

  const dismissArrival = useCallback(() => {
    setArrival((current) => {
      if (current) clearLaunchArrival(current.workspaceId)
      return null
    })
  }, [])

  useEffect(() => {
    fetch("/api/setup/status")
      .then((r) => r.json())
      .then((d: { demoMode?: boolean }) => {
        if (d.demoMode) setDemoMode(true)
      })
      .catch(() => null)
  }, [])

  const fetchInbox = useCallback(async () => {
    try {
      const res = await fetch("/api/inbox", { cache: "no-store" })
      const d = (await res.json()) as { emails?: EmailEntry[] }
      setEmails(Array.isArray(d.emails) ? d.emails : [])
    } catch {
      setEmails([])
    }
  }, [])

  const fetchAll = useCallback(async () => {
    const [sessRes, taskRes, projRes, intelRes, goalsRes, activityRes, convRes, calRes] =
      await Promise.allSettled([
        fetch("/api/sessions", { cache: "no-store" }).then((r) => r.json()),
        fetch("/api/tasks", { cache: "no-store" }).then((r) => r.json()),
        fetch("/api/projects", { cache: "no-store" }).then((r) => r.json()),
        fetch("/api/intel/report", { cache: "no-store" }).then((r) => r.json()),
        fetch("/api/company/goals", { cache: "no-store" }).then((r) => r.json()),
        fetch("/api/activity?canonical=1", { cache: "no-store" }).then((r) => r.json()),
        fetch("/api/conversations", { cache: "no-store" }).then((r) => r.json()),
        fetch("/api/calendar", { cache: "no-store" }).then((r) => r.json()),
      ])

    if (sessRes.status === "fulfilled") {
      const d = sessRes.value as { sessions?: Session[] } | Session[]
      setSessions(Array.isArray(d) ? d : (d.sessions ?? []))
    }
    if (taskRes.status === "fulfilled") {
      const d = taskRes.value as Task[]
      setTasks(Array.isArray(d) ? d : [])
    }
    if (projRes.status === "fulfilled") {
      const d = projRes.value as Repo[]
      setRepos(Array.isArray(d) ? d : [])
    }
    if (intelRes.status === "fulfilled") {
      setIntel(intelRes.value as IntelReport)
    }
    if (goalsRes.status === "fulfilled") {
      const g = goalsRes.value as Goal[]
      setGoals(Array.isArray(g) ? g : [])
    }
    if (activityRes.status === "fulfilled") {
      const a = activityRes.value as ActivityEntry[]
      setRecentActivity(Array.isArray(a) ? a.slice(0, 5) : [])
    }
    if (convRes.status === "fulfilled") {
      const c = convRes.value as ConversationSummary[] | { conversations?: ConversationSummary[] }
      setConversations(Array.isArray(c) ? c : (c.conversations ?? []))
    }
    if (calRes.status === "fulfilled") {
      const c = calRes.value as { events?: CalendarEvent[] }
      setEvents(Array.isArray(c?.events) ? c.events : [])
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    const boot = setTimeout(() => {
      void fetchAll()
      void fetchInbox()
    }, 0)
    const interval = setInterval(fetchAll, 30_000)
    const inboxInterval = setInterval(fetchInbox, 60_000)
    return () => { clearTimeout(boot); clearInterval(interval); clearInterval(inboxInterval) }
  }, [fetchAll, fetchInbox])

  const pinnedRepos = PINNED.map((name) => repos.find((r) => r.name === name)).filter(
    (r): r is Repo => r !== undefined,
  )

  const taskCounts = TASK_COLUMNS.map(({ id, label }) => ({
    id,
    label,
    count: tasks.filter((t) => t.column === id).length,
  }))

  const intelSummary = intel?.summary || intel?.headline || "No scout report yet."
  const activeGoals = goals.filter((g) => g.status === "active").slice(0, 3)
  const urgentTasks = tasks
    .filter((task) => task.column !== "done")
    .sort((a, b) => {
      const priorityOrder: Record<string, number> = { high: 0, medium: 1, low: 2 }
      return (priorityOrder[a.priority] ?? 3) - (priorityOrder[b.priority] ?? 3)
    })
    .slice(0, 6)
  const liveWorkItems = tasks
    .filter((task) => task.column === "in-progress" || task.column === "in-review")
    .slice(0, 4)
    .map((task) => {
      const conversation = conversations.find((conv) => conv.taskId === task.id)
      const latestActivity = recentActivity.find((entry) => entry.taskId === task.id)
      const lastHeard = latestActivity?.timestamp ?? conversation?.lastMessageAt ?? conversation?.updatedAt ?? ""
      return { task, conversation, latestActivity, lastHeard }
    })

  // Calendar feed: next five events, grouped by day label.
  const upcomingEvents = [...events]
    .sort((a, b) => a.start.localeCompare(b.start))
    .slice(0, 5)
  const firstEventDay = upcomingEvents[0]?.start.split("T")[0] ?? ""

  const openChiefWith = (prompt: string) => router.push(`/assistant?prefill=${encodeURIComponent(prompt)}`)

  return (
    <div className="relative mx-auto max-w-[820px] px-5 pb-24 pt-2 lg:px-8">
      {/* meta row */}
      <div className="flex items-center justify-between">
        <span
          className="inline-flex items-center gap-2 rounded-full border px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.08em]"
          style={{ borderColor: "var(--line)", backgroundColor: "var(--surface-1)", color: "var(--ink-2)" }}
        >
          <span
            className="h-[5px] w-[5px] rounded-full"
            style={{ backgroundColor: "var(--dock-ready)" }}
          />
          {loading ? "syncing…" : "Workspace"} · {repos.length} projects
        </span>
        <span className="font-mono text-[10.5px] uppercase tracking-[0.1em]" style={{ color: "var(--ink-3)" }}>
          {getFormattedDate()}
        </span>
      </div>

      {/* greeting */}
      <h1
        className="dock-entry-title mt-8"
        style={{ color: "var(--ink)" }}
      >
        Work
      </h1>
      <p className="mt-2.5 text-[14px]" style={{ color: "var(--ink-2)" }}>
        {loading ? "Loading recent work…" : (
          <>
            Your agents moved <b style={{ color: "var(--ink)", fontWeight: 550 }}>{recentActivity.length} things</b> recently ·{" "}
            <b style={{ color: "var(--ink)", fontWeight: 550 }}>
              {taskCounts.find((c) => c.id === "in-progress")?.count ?? 0} tasks in flight
            </b>
            {emails.length > 0 ? ` · ${emails.length} inbox item${emails.length === 1 ? "" : "s"}` : ""}
            {urgentTasks.length > 0 ? `. ${urgentTasks.length >= 2 ? "Two decisions" : "One decision"} waiting for you.` : "."}
          </>
        )}
      </p>

      {/* arrival card (one-time post-launch handoff) */}
      {arrival && <LaunchCard goal={arrival.goal} onDismiss={dismissArrival} />}

      {/* executive brief */}
      <section
        className="relative mt-8 overflow-hidden rounded-2xl border p-7 pb-6"
        style={{ borderColor: "var(--line)", background: "var(--dock-panel)" }}
      >
        <div
          className="mb-4 flex items-center gap-2.5 font-mono text-[9.5px] uppercase tracking-[0.16em]"
          style={{ color: "var(--ink-3)" }}
        >
          work brief · {intel?.generatedAt ? relativeTime(intel.generatedAt) : "live"}
        </div>
        <p className="max-w-[62ch] text-[15px] leading-[1.72]" style={{ color: "#c3c6d4" }}>
          {intelSummary}{" "}
          {recentActivity[0] && (
            <>
              <b style={{ color: "var(--ink)", fontWeight: 550 }}>{recentActivity[0].agent}</b>{" "}
              {ACTION_LABEL_MAP[recentActivity[0].action] ?? "touched"} &ldquo;{recentActivity[0].taskTitle}&rdquo;{" "}
              {relativeTime(recentActivity[0].timestamp)}.
            </>
          )}{" "}
          {hotRiskRepo(repos) ? (
            <>
              <b style={{ color: "var(--ink)", fontWeight: 550 }}>One risk:</b> {hotRiskLabel(repos)}.
            </>
          ) : (
            <>All pipelines green.</>
          )}
        </p>
        <div className="mt-5 flex flex-wrap items-center gap-2.5">
          <button
            onClick={() => openChiefWith("Walk me through today's brief.")}
            className="dock-action"
          >
            Discuss with your chief of staff
          </button>
          <Link
            href="/tasks"
            className="rounded-[10px] border px-4 py-2 text-[12.5px] font-semibold transition-all duration-200 hover:-translate-y-[1px]"
            style={{ borderColor: "var(--line-strong)", backgroundColor: "var(--surface-2)", color: "var(--ink)" }}
          >
            Missions board
          </Link>
          <button
            onClick={() => openChiefWith("What are the agents working on right now?")}
            className="px-2.5 py-2 text-[12.5px] font-normal transition-colors"
            style={{ color: "var(--ink-3)" }}
          >
            Ask what agents are working on
          </button>
        </div>
      </section>

      {/* work rail */}
      <div className="mb-4 mt-10 flex items-baseline justify-between">
        <h2 className="text-[12px] font-semibold uppercase tracking-[0.14em]" style={{ color: "var(--ink-2)" }}>
          Work rails
        </h2>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {WORK_RAIL.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="group rounded-[15px] border p-4 text-left transition-all duration-300 hover:-translate-y-[2px]"
            style={{ borderColor: "var(--line)", backgroundColor: "var(--surface-1)" }}
          >
            <div className="mb-1.5 flex items-center gap-2">
              <span className="text-[14px]">{item.emoji}</span>
              <span className="text-[12.5px] font-semibold">{item.label}</span>
            </div>
            <p className="text-[11px]" style={{ color: "var(--ink-3)" }}>{item.hint}</p>
          </Link>
        ))}
      </div>

      {/* fleet */}
      <div className="mb-4 mt-10 flex items-baseline justify-between">
        <h2 className="text-[12px] font-semibold uppercase tracking-[0.14em]" style={{ color: "var(--ink-2)" }}>
          Fleet
        </h2>
        <Link href="/agents" className="text-[12px] transition-colors" style={{ color: "var(--ink-3)" }}>
          all agents →
        </Link>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {AGENT_DEFS.map((agent) => {
          const live = isSessionActive(sessions, agent.keys)
          return (
            <button
              key={agent.name}
              onClick={() => openChiefWith(`What's ${agent.name} working on?`)}
              className="group rounded-[15px] border p-4 text-left transition-all duration-300 hover:-translate-y-[2px]"
              style={{ borderColor: "var(--line)", backgroundColor: "var(--surface-1)" }}
            >
              <div className="mb-2 flex items-center gap-2">
                <span className="text-[15px]">{agent.emoji}</span>
                <span className="text-[12.5px] font-semibold">{agent.name}</span>
                {live && (
                  <span
                    className="ml-auto h-[5px] w-[5px] rounded-full"
                    style={{ backgroundColor: "#6ee7b7", boxShadow: "0 0 8px #6ee7b7" }}
                  />
                )}
              </div>
              <p className="line-clamp-2 min-h-[32px] text-[11px] leading-[1.45]" style={{ color: "var(--ink-3)" }}>
                {live ? "standing by" : "idle"}
              </p>
            </button>
          )
        })}
      </div>

      {/* missions board */}
      <div className="mb-4 mt-10 flex items-baseline justify-between">
        <h2 className="text-[12px] font-semibold uppercase tracking-[0.14em]" style={{ color: "var(--ink-2)" }}>
          Missions board
        </h2>
        <Link href="/tasks" className="text-[12px] transition-colors" style={{ color: "var(--ink-3)" }}>
          full screen →
        </Link>
      </div>
      <TasksBoard />

      {/* decisions */}
      <div className="mb-4 mt-10 flex items-baseline justify-between">
        <h2 className="text-[12px] font-semibold uppercase tracking-[0.14em]" style={{ color: "var(--ink-2)" }}>
          Decisions
        </h2>
        <Link href="/inbox" className="text-[12px] transition-colors" style={{ color: "var(--ink-3)" }}>
          inbox →
        </Link>
      </div>
      <div className="overflow-hidden rounded-[15px] border" style={{ borderColor: "var(--line)", backgroundColor: "var(--surface-1)" }}>
        {urgentTasks.length === 0 && !loading && (
          <p className="p-5 text-[13px]" style={{ color: "var(--ink-3)" }}>
            Nothing needs you — the fleet has it handled.
          </p>
        )}
        {(loading ? Array.from({ length: 3 }) : urgentTasks.slice(0, 3)).map((task, i) =>
          task ? (
            <button
              key={(task as Task).id}
              onClick={() => openChiefWith(`Brief me on "${(task as Task).title}" — what's the decision?`)}
              className="grid w-full grid-cols-[26px_1fr_auto_18px] items-center gap-3.5 border-b px-5 py-4 text-left transition-colors last:border-b-0 hover:bg-[var(--surface-2)]"
              style={{ borderColor: "var(--line)" }}
            >
              <span
                className="flex h-5 w-5 items-center justify-center rounded-[7px] border-[1.5px] text-[9px]"
                style={{
                  color: (task as Task).column === "in-review" ? "#6ee7b7" : PRIORITY_COLOR[(task as Task).priority] ?? "#6ee7b7",
                  borderColor: (task as Task).column === "in-review" ? "rgba(110,231,183,.3)" : "var(--line-strong)",
                }}
              >
                {(task as Task).column === "in-review" ? "✓" : "!"}
              </span>
              <span>
                <span className="block text-[13.5px] font-semibold tracking-[-0.003em]">{(task as Task).title}</span>
                <span className="mt-0.5 block text-[11.5px]" style={{ color: "var(--ink-3)" }}>
                  <b style={{ color: "var(--ink-2)", fontWeight: 500 }}>{(task as Task).assignee}</b> ·{" "}
                  {(task as Task).column.replace("-", " ")} · {(task as Task).priority} priority
                </span>
              </span>
              <span
                className="whitespace-nowrap rounded-full px-2.5 py-1 font-mono text-[10px] tracking-[0.05em]"
                style={
                  (task as Task).column === "in-review"
                    ? { color: "#6ee7b7", backgroundColor: "rgba(110,231,183,.07)", boxShadow: "inset 0 0 0 1px rgba(110,231,183,.2)" }
                    : { color: "var(--gold)", backgroundColor: "rgba(231,201,121,.09)", boxShadow: "inset 0 0 0 1px rgba(231,201,121,.25)" }
                }
              >
                {(task as Task).column === "in-review" ? "on rails" : "needs you"}
              </span>
              <span className="text-[13px]" style={{ color: "var(--ink-3)" }}>→</span>
            </button>
          ) : (
            <div key={i} className="border-b px-5 py-4 last:border-b-0" style={{ borderColor: "var(--line)" }}>
              <div className="h-3.5 w-2/3 animate-pulse rounded" style={{ backgroundColor: "var(--surface-3)" }} />
            </div>
          ),
        )}
      </div>

      {/* live work */}
      {liveWorkItems.length > 0 && (
        <>
          <div className="mb-4 mt-10 flex items-baseline justify-between">
            <h2 className="text-[12px] font-semibold uppercase tracking-[0.14em]" style={{ color: "var(--ink-2)" }}>
              Live work
            </h2>
            <Link href="/conversations" className="text-[12px] transition-colors" style={{ color: "var(--ink-3)" }}>
              conversations →
            </Link>
          </div>
          <div className="flex flex-col gap-1.5">
            {liveWorkItems.map(({ task, conversation, lastHeard }) => (
              <button
                key={task.id}
                onClick={() => openChiefWith(`Status on "${task.title}"?`)}
                className="flex items-center gap-3 rounded-[11px] border px-4 py-2.5 text-left transition-all duration-200 hover:translate-x-[3px]"
                style={{ borderColor: "var(--line)", backgroundColor: "var(--surface-1)" }}
              >
                <span
                  className="flex h-[15px] w-[15px] shrink-0 items-center justify-center rounded-[5px] text-[8px]"
                  style={{
                    backgroundColor: task.column === "in-progress" ? "rgba(103,232,249,.1)" : "rgba(110,231,183,.12)",
                    color: task.column === "in-progress" ? "#67e8f9" : "#6ee7b7",
                  }}
                >
                  {task.column === "in-progress" ? "◐" : "✓"}
                </span>
                <span className="flex-1 text-[12.5px]" style={{ color: "#d4d7e3" }}>
                  {task.title}
                </span>
                <span className="font-mono text-[10px]" style={{ color: "var(--ink-3)" }}>
                  {AGENT_EMOJI_MAP[task.assignee] ?? "·"} {task.assignee}
                  {lastHeard ? ` · ${relativeTime(lastHeard)}` : ""}
                  {conversation ? ` · ${conversation.runCount} runs` : ""}
                </span>
              </button>
            ))}
          </div>
        </>
      )}

      {/* portfolio */}
      <div className="mb-4 mt-10 flex items-baseline justify-between">
        <h2 className="text-[12px] font-semibold uppercase tracking-[0.14em]" style={{ color: "var(--ink-2)" }}>
          Portfolio
        </h2>
        <Link href="/projects" className="text-[12px] transition-colors" style={{ color: "var(--ink-3)" }}>
          all projects →
        </Link>
      </div>
      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
        {pinnedRepos.map((repo) => (
          <Link
            key={repo.name}
            href={`/projects/${encodeURIComponent(repo.name)}`}
            className="group rounded-[15px] border p-[18px] transition-all duration-300 hover:-translate-y-[2px]"
            style={{ borderColor: "var(--line)", backgroundColor: "var(--surface-1)" }}
          >
            <div className="mb-3.5 flex items-center gap-2.5">
              <span
                className="flex h-[34px] w-[34px] items-center justify-center rounded-[10px] border font-medium text-[17px]"
                style={{ borderColor: "var(--line)", backgroundColor: "var(--surface-3)", color: "var(--ink-2)" }}
              >
                ◈
              </span>
              <span>
                <span className="block text-[14px] font-semibold">{repo.name}</span>
                <span className="mt-px block line-clamp-1 text-[11px]" style={{ color: "var(--ink-3)" }}>
                  {repo.description ?? "—"}
                </span>
              </span>
              <span
                className="ml-auto flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.1em]"
                style={{ color: "var(--ink-3)" }}
              >
                <span
                  className="h-[5px] w-[5px] rounded-full"
                  style={{ backgroundColor: ciColor(repo.latestRun), boxShadow: `0 0 8px ${ciColor(repo.latestRun)}` }}
                />
                {ciLabel(repo.latestRun)}
              </span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-[20px] font-medium tabular-nums">{repo.openPRs.length}</span>
              <span className="font-mono text-[10.5px] uppercase tracking-[0.08em]" style={{ color: "var(--ink-3)" }}>
                open PRs
              </span>
              <span className="ml-auto font-mono text-[10px]" style={{ color: "var(--ink-3)" }}>
                {relativeTime(repo.updatedAt)}
              </span>
            </div>
          </Link>
        ))}
        {!loading && pinnedRepos.length === 0 && (
          <p className="text-[13px]" style={{ color: "var(--ink-3)" }}>
            No pinned projects yet — connect GitHub on the projects page.
          </p>
        )}
      </div>

      {/* calendar feed */}
      <div className="mb-4 mt-10 flex items-baseline justify-between">
        <h2 className="text-[12px] font-semibold uppercase tracking-[0.14em]" style={{ color: "var(--ink-2)" }}>
          Calendar
        </h2>
        <Link href="/calendar" className="text-[12px] transition-colors" style={{ color: "var(--ink-3)" }}>
          all events →
        </Link>
      </div>
      <div className="overflow-hidden rounded-[15px] border" style={{ borderColor: "var(--line)", backgroundColor: "var(--surface-1)" }}>
        {upcomingEvents.length === 0 ? (
          <p className="p-5 text-[13px]" style={{ color: "var(--ink-3)" }}>
            No upcoming events.
          </p>
        ) : (
          upcomingEvents.map((ev) => (
            <div
              key={ev.id}
              className="flex items-center gap-3.5 border-b px-5 py-3.5 last:border-b-0"
              style={{ borderColor: "var(--line)" }}
            >
              <div className="w-[74px] shrink-0">
                <p className="text-[11px] font-medium" style={{ color: "var(--ink-2)" }}>
                  {ev.start.split("T")[0] === firstEventDay ? formatDateLabel(ev.start) : formatDateLabel(ev.start)}
                </p>
                <p className="font-mono text-[10px]" style={{ color: "var(--ink-3)" }}>
                  {formatEventWindow(ev)}
                </p>
              </div>
              <span className="flex-1 truncate text-[13px]" style={{ color: "#d4d7e3" }}>{ev.title}</span>
              {ev.location && (
                <span className="hidden font-mono text-[10px] sm:block" style={{ color: "var(--ink-3)" }}>
                  {ev.location}
                </span>
              )}
            </div>
          ))
        )}
      </div>

      {/* goals + inbox + activity side-by-side feeds */}
      <div className="mt-10 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section>
          <div className="mb-4 flex items-baseline justify-between">
            <h2 className="text-[12px] font-semibold uppercase tracking-[0.14em]" style={{ color: "var(--ink-2)" }}>
              Company goals
            </h2>
            <Link href="/company" className="text-[12px] transition-colors" style={{ color: "var(--ink-3)" }}>
              company →
            </Link>
          </div>
          <div className="space-y-2">
            {activeGoals.length === 0 ? (
              <p className="rounded-[11px] border p-4 text-[12.5px]" style={{ borderColor: "var(--line)", color: "var(--ink-3)" }}>
                No active goals.
              </p>
            ) : (
              activeGoals.map((goal) => (
                <Link
                  key={goal.id}
                  href="/company"
                  className="block rounded-[11px] border px-4 py-3 transition-colors hover:bg-[var(--surface-2)]"
                  style={{ borderColor: "var(--line)", backgroundColor: "var(--surface-1)" }}
                >
                  <p className="text-[12.5px] font-semibold">{goal.title}</p>
                  <div className="mt-2 h-1 w-full overflow-hidden rounded-full" style={{ backgroundColor: "var(--surface-3)" }}>
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${goal.progress?.percent ?? 0}%`,
                        backgroundColor: PRIORITY_COLOR[goal.priority] ?? "var(--gold)",
                      }}
                    />
                  </div>
                  <p className="mt-1.5 font-mono text-[10px]" style={{ color: "var(--ink-3)" }}>
                    {goal.progress?.done ?? 0}/{goal.progress?.total ?? 0} · {goal.priority}
                  </p>
                </Link>
              ))
            )}
          </div>
        </section>

        <section>
          <div className="mb-4 flex items-baseline justify-between">
            <h2 className="text-[12px] font-semibold uppercase tracking-[0.14em]" style={{ color: "var(--ink-2)" }}>
              Waiting on you
            </h2>
            <Link href="/inbox" className="text-[12px] transition-colors" style={{ color: "var(--ink-3)" }}>
              inbox →
            </Link>
          </div>
          <div className="space-y-2">
            {emails.length === 0 ? (
              <p className="rounded-[11px] border p-4 text-[12.5px]" style={{ borderColor: "var(--line)", color: "var(--ink-3)" }}>
                Inbox clear.
              </p>
            ) : (
              emails.slice(0, 3).map((email) => (
                <Link
                  key={email.id}
                  href="/inbox"
                  className="block rounded-[11px] border px-4 py-3 transition-colors hover:bg-[var(--surface-2)]"
                  style={{ borderColor: "var(--line)", backgroundColor: "var(--surface-1)" }}
                >
                  <p className="truncate text-[12.5px] font-semibold">{email.subject}</p>
                  <p className="mt-0.5 truncate text-[11px]" style={{ color: "var(--ink-3)" }}>
                    {email.fromName || email.from} · {relativeTime(email.date)}
                  </p>
                </Link>
              ))
            )}
          </div>
        </section>
      </div>

      {/* activity strip */}
      <div className="mb-4 mt-10 flex items-baseline justify-between">
        <h2 className="text-[12px] font-semibold uppercase tracking-[0.14em]" style={{ color: "var(--ink-2)" }}>
          Recent runs
        </h2>
        <Link href="/activity" className="text-[12px] transition-colors" style={{ color: "var(--ink-3)" }}>
          activity →
        </Link>
      </div>
      <div className="overflow-hidden rounded-[15px] border" style={{ borderColor: "var(--line)", backgroundColor: "var(--surface-1)" }}>
        {recentActivity.length === 0 ? (
          <p className="p-5 text-[13px]" style={{ color: "var(--ink-3)" }}>
            No runs recorded yet.
          </p>
        ) : (
          recentActivity.map((entry) => (
            <Link
              key={entry.id}
              href={entry.taskId ? `/conversations?id=task-${entry.taskId}` : "/conversations"}
              className="flex items-center gap-3.5 border-b px-5 py-3.5 last:border-b-0 transition-colors hover:bg-[var(--surface-2)]"
              style={{ borderColor: "var(--line)" }}
            >
              <span
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[7px] text-[10px]"
                style={{ backgroundColor: `${ACTION_COLOR_MAP[entry.action]}1f`, color: ACTION_COLOR_MAP[entry.action] }}
              >
                {AGENT_EMOJI_MAP[entry.agent] ?? "🤖"}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12.5px]">
                  <b className="font-semibold" style={{ color: ACTION_COLOR_MAP[entry.action] }}>{entry.agent}</b>{" "}
                  <span style={{ color: "var(--ink-3)" }}>{ACTION_LABEL_MAP[entry.action]}</span>{" "}
                  <span>{entry.taskTitle}</span>
                </span>
                {entry.summary && (
                  <span className="mt-0.5 block truncate text-[11px]" style={{ color: "var(--ink-3)" }}>
                    {entry.summary}
                  </span>
                )}
              </span>
              <span className="shrink-0 font-mono text-[10px]" style={{ color: "var(--ink-3)" }}>
                {relativeTime(entry.timestamp)}
              </span>
            </Link>
          ))
        )}
      </div>

      {demoMode && (
        <p className="mt-8 text-center font-mono text-[11px]" style={{ color: "var(--ink-3)" }}>
          Demo mode — no runtime connected.
        </p>
      )}
    </div>
  )
}
