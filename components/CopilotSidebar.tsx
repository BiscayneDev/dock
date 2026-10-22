"use client"

import Link from "next/link"
import { useMemo, useState } from "react"
import { CHIEF_RUNTIME_KEY } from "@/lib/chief-key"

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

interface Goal {
  id: string
  title: string
  status: "active" | "completed" | "paused"
  priority: "high" | "medium" | "low"
  progress?: { total: number; done: number; percent: number }
}

interface ActivityEntry {
  id: string
  taskTitle: string
  agent: string
  action: string
  timestamp: string
}

interface InboxItem {
  id: string
  fromName: string
  subject: string
  snippet?: string
  date: string
}

interface ApprovalItem {
  id: string
  label: string
  detail: string
  severity: "high" | "medium" | "low"
  taskId?: string
  taskTitle?: string
  taskDescription?: string
  assignee?: string
  priority?: string
}

interface CopilotSidebarProps {
  activeGoals: Goal[]
  urgentTasks: Task[]
  repos: Repo[]
  recentActivity: ActivityEntry[]
  inboxItems: InboxItem[]
  intelSummary: string
  demoMode: boolean
}

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  const hrs = Math.floor(diff / 3600000)
  if (mins < 1) return "now"
  if (mins < 60) return `${mins}m`
  if (hrs < 24) return `${hrs}h`
  return `${Math.floor(hrs / 24)}d`
}

async function postJson(url: string, body: unknown) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  return res.json().catch(() => ({})) as Promise<Record<string, unknown>>
}

export function CopilotSidebar({ activeGoals, urgentTasks, repos, recentActivity, inboxItems, intelSummary, demoMode }: CopilotSidebarProps) {
  const [busyId, setBusyId] = useState<string | null>(null)
  const [statusMessage, setStatusMessage] = useState<string>("")

  const topPriority = urgentTasks.slice(0, 3)
  const hotRepo = repos.find((r) => r.latestRun?.status === "in_progress" || r.latestRun?.conclusion !== "success") ?? repos[0]
  const lastAction = recentActivity[0]

  const approvalQueue = useMemo(() => {
    const priorityScore = { high: 3, medium: 2, low: 1 }
    const columnScore = { "in-review": 3, "in-progress": 2, backlog: 1, done: 0 }
    const inboxText = inboxItems.map((item) => `${item.fromName} ${item.subject} ${item.snippet ?? ""}`.toLowerCase()).join(" ")

    const scored = urgentTasks
      .filter((task) => task.column !== "done")
      .map((task) => {
        const priority = priorityScore[task.priority as keyof typeof priorityScore] ?? 1
        const column = columnScore[task.column as keyof typeof columnScore] ?? 0
        const goalHit = activeGoals.some((goal) => goal.title.toLowerCase().includes(task.title.toLowerCase()))
        const activityHit = recentActivity.some((entry) => entry.taskTitle.toLowerCase().includes(task.title.toLowerCase()) || entry.agent.toLowerCase() === task.assignee.toLowerCase()) ? 1 : 0
        const inboxHit = inboxText.includes(task.title.toLowerCase()) ? 1 : 0
        const repoHit = repos.some((repo) => repo.name.toLowerCase().includes(task.title.toLowerCase()) || repo.latestRun?.conclusion !== "success") ? 1 : 0
        const score = priority * 30 + column * 20 + (goalHit ? 15 : 0) + activityHit * 10 + inboxHit * 5 + repoHit * 3
        return { task, score }
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)

    const items: ApprovalItem[] = scored.map(({ task }, index) => ({
      id: `task-${task.id}`,
      label: index === 0 ? "Approve top task" : index === 1 ? "Hold secondary task" : "Review backlog task",
      detail: `${task.title} • ${task.priority} • ${task.column}`,
      severity: index === 0 ? "high" : index === 1 ? "medium" : "low",
      taskId: task.id,
      taskTitle: task.title,
      taskDescription: task.description,
      assignee: task.assignee,
      priority: task.priority,
    }))

    if (items.length < 3 && inboxItems[0]) {
      items.push({
        id: `delegate-${inboxItems[0].id}`,
        label: "Delegate inbound response",
        detail: `${inboxItems[0].fromName}: ${inboxItems[0].subject}`,
        severity: "low",
      })
    }

    return items
  }, [activeGoals, inboxItems, recentActivity, repos, urgentTasks])

  const briefLines = [
    `You have ${urgentTasks.length} open tasks, ${activeGoals.length} active goals, and ${inboxItems.length} inbox item${inboxItems.length === 1 ? "" : "s"}.`,
    hotRepo ? `${hotRepo.name} is the biggest risk signal.` : "No current project risk signal.",
    lastAction ? `${lastAction.agent} last ${lastAction.action} “${lastAction.taskTitle}”.` : "No recent agent activity.",
  ]

  async function approve(item: ApprovalItem) {
    if (!item.taskId) return
    setBusyId(item.id)
    setStatusMessage("")
    try {
      await postJson(`/api/tasks/${item.taskId}`, {
        column: "in-progress",
        assignee: item.assignee,
      })
      await postJson("/api/activity", {
        taskId: item.taskId,
        taskTitle: item.taskTitle ?? item.label,
        agent: item.assignee ?? CHIEF_RUNTIME_KEY,
        action: "started",
        summary: `Approved: ${item.taskTitle ?? item.label}`,
      })
      setStatusMessage(`Approved ${item.taskTitle ?? item.label}`)
    } catch {
      setStatusMessage(`Could not approve ${item.taskTitle ?? item.label}`)
    } finally {
      setBusyId(null)
    }
  }

  async function hold(item: ApprovalItem) {
    if (!item.taskId) return
    setBusyId(item.id)
    setStatusMessage("")
    try {
      await postJson(`/api/tasks/${item.taskId}`, {
        column: "backlog",
        description: `${item.taskDescription ?? ""}\n\n[HOLD] Paused from copilot approval queue.`.trim(),
      })
      await postJson("/api/activity", {
        taskId: item.taskId,
        taskTitle: item.taskTitle ?? item.label,
        agent: item.assignee ?? CHIEF_RUNTIME_KEY,
        action: "reviewed",
        summary: `Held: ${item.taskTitle ?? item.label}`,
      })
      setStatusMessage(`Held ${item.taskTitle ?? item.label}`)
    } catch {
      setStatusMessage(`Could not hold ${item.taskTitle ?? item.label}`)
    } finally {
      setBusyId(null)
    }
  }

  async function delegate(item: ApprovalItem) {
    if (!item.taskId) return
    setBusyId(item.id)
    setStatusMessage("")
    try {
      await postJson("/api/tasks/activate", {
        taskId: item.taskId,
        title: item.taskTitle ?? item.label,
        description: item.taskDescription,
        assignee: item.assignee ?? CHIEF_RUNTIME_KEY,
        priority: item.priority ?? "medium",
      })
      setStatusMessage(`Delegated ${item.taskTitle ?? item.label}`)
    } catch {
      setStatusMessage(`Could not delegate ${item.taskTitle ?? item.label}`)
    } finally {
      setBusyId(null)
    }
  }

  return (
    <aside className="space-y-3 lg:sticky lg:top-6 self-start lg:max-w-[288px]">
      <div className="rounded-2xl border border-cyan-500/20 bg-[#101018] p-4 shadow-[0_0_30px_rgba(34,211,238,0.06)]">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-300">Copilot</p>
            <h2 className="mt-1 text-lg font-semibold text-white">Company brief</h2>
          </div>
          <span className="rounded-full border border-cyan-500/20 bg-cyan-500/10 px-2 py-1 text-[10px] font-semibold text-cyan-300">
            {demoMode ? "Demo" : "Live"}
          </span>
        </div>

        <div className="mt-3 space-y-2">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-zinc-500">Morning brief</p>
          <div className="rounded-xl border border-zinc-800 bg-black/20 p-3 text-sm leading-6 text-zinc-300">
            {briefLines.map((line) => (
              <p key={line} className="mb-2 last:mb-0">
                {line}
              </p>
            ))}
          </div>
          <p className="text-sm leading-6 text-zinc-300">{intelSummary}</p>
          {statusMessage ? <p className="text-xs text-cyan-300">{statusMessage}</p> : null}
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <Link href="/tasks" className="rounded-xl border border-zinc-800 bg-black/20 px-3 py-2 text-xs font-medium text-white hover:border-cyan-500/30 hover:bg-cyan-500/10">
            Review tasks
          </Link>
          <Link href="/conversations" className="rounded-xl border border-zinc-800 bg-black/20 px-3 py-2 text-xs font-medium text-white hover:border-cyan-500/30 hover:bg-cyan-500/10">
            Open chat
          </Link>
        </div>
      </div>

      <div className="rounded-2xl border border-zinc-800 bg-[#111118] p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">Top priorities</h3>
          <Link href="/tasks" className="text-[10px] font-medium text-cyan-300 hover:text-cyan-200">All tasks →</Link>
        </div>
        <div className="mt-3 space-y-2">
          {topPriority.length === 0 ? (
            <p className="text-sm text-zinc-500">No urgent work.</p>
          ) : topPriority.map((task) => (
            <div key={task.id} className="rounded-xl border border-zinc-800 bg-black/20 px-3 py-2">
              <p className="text-sm text-white line-clamp-2">{task.title}</p>
              <p className="mt-1 text-[11px] text-zinc-500">{task.priority} • {task.column} • @{task.assignee}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-zinc-800 bg-[#111118] p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">Risks</h3>
          <Link href="/alerts" className="text-[10px] font-medium text-amber-300 hover:text-amber-200">
            Open alerts →
          </Link>
        </div>
        <div className="mt-3 space-y-2">
          <Link href={hotRepo ? `/projects/${encodeURIComponent(hotRepo.name)}` : "/alerts"} className="block rounded-xl border border-amber-500/20 bg-amber-500/5 px-3 py-2 transition-colors hover:bg-amber-500/10 hover:border-amber-500/30">
            <p className="text-sm text-amber-200">{hotRepo ? `${hotRepo.name} needs attention` : "No repo risk detected"}</p>
            {hotRepo ? <p className="mt-1 text-[11px] text-zinc-500">Last updated {relativeTime(hotRepo.updatedAt)}</p> : null}
          </Link>
          {lastAction ? (
            <Link href="/tasks" className="block rounded-xl border border-zinc-800 bg-black/20 px-3 py-2 transition-colors hover:border-cyan-500/30 hover:bg-cyan-500/5">
              <p className="text-sm text-zinc-200">Latest action: {lastAction.agent} {lastAction.action} “{lastAction.taskTitle}”</p>
            </Link>
          ) : null}
        </div>
      </div>

      <div className="rounded-2xl border border-zinc-800 bg-[#111118] p-4">
        <h3 className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">Approval queue</h3>
        <div className="mt-3 space-y-2">
          {approvalQueue.length === 0 ? (
            <p className="text-sm text-zinc-500">Nothing awaiting approval.</p>
          ) : (
            approvalQueue.map((item) => (
              <div key={item.id} className="rounded-xl border border-zinc-800 bg-black/20 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm text-white">{item.label}</p>
                    <p className="mt-1 text-[11px] text-zinc-500">{item.detail}</p>
                  </div>
                  <span className="rounded-full border border-zinc-700 px-2 py-1 text-[10px] uppercase tracking-widest text-zinc-400">
                    {item.severity}
                  </span>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2 text-[11px]">
                  <button
                    disabled={busyId === item.id}
                    onClick={() => void approve(item)}
                    className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-2 py-1 text-emerald-200 hover:bg-emerald-500/15 disabled:opacity-50"
                  >
                    Approve
                  </button>
                  <button
                    disabled={busyId === item.id}
                    onClick={() => void hold(item)}
                    className="rounded-lg border border-amber-500/20 bg-amber-500/10 px-2 py-1 text-amber-200 hover:bg-amber-500/15 disabled:opacity-50"
                  >
                    Hold
                  </button>
                  <button
                    disabled={busyId === item.id}
                    onClick={() => void delegate(item)}
                    className="rounded-lg border border-cyan-500/20 bg-cyan-500/10 px-2 py-1 text-cyan-200 hover:bg-cyan-500/15 disabled:opacity-50"
                  >
                    Delegate
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="rounded-2xl border border-zinc-800 bg-[#111118] p-4">
        <h3 className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">Execute</h3>
        <div className="mt-3 grid gap-2">
          <Link href="/company" className="rounded-xl border border-zinc-800 bg-black/20 px-3 py-2 text-xs font-medium text-white hover:border-purple-500/30 hover:bg-purple-500/10">Update goals</Link>
          <Link href="/alerts" className="rounded-xl border border-zinc-800 bg-black/20 px-3 py-2 text-xs font-medium text-white hover:border-rose-500/30 hover:bg-rose-500/10">Review alerts</Link>
          <Link href="/projects" className="rounded-xl border border-zinc-800 bg-black/20 px-3 py-2 text-xs font-medium text-white hover:border-emerald-500/30 hover:bg-emerald-500/10">Check projects</Link>
        </div>
      </div>

      <div className="rounded-2xl border border-zinc-800 bg-[#111118] p-4">
        <h3 className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">Context</h3>
        <div className="mt-3 space-y-2 text-sm">
          <p className="text-zinc-300">{activeGoals.length} active goal{activeGoals.length === 1 ? "" : "s"}</p>
          <p className="text-zinc-300">{inboxItems.length} inbox item{inboxItems.length === 1 ? "" : "s"}</p>
          <p className="text-zinc-300">{repos.length} project{repos.length === 1 ? "" : "s"}</p>
        </div>
      </div>
    </aside>
  )
}
