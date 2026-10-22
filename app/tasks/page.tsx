"use client"

import Link from "next/link"
import { useEffect, useState, useCallback, useRef } from "react"
import {
  DragDropContext,
  Droppable,
  Draggable,
  type DropResult,
} from "@hello-pangea/dnd"
import type { Task, Column, Priority, Agent } from "@/lib/tasks"
import {
  COLUMNS,
  AGENT_EMOJI,
  AGENT_LABELS,
  PRIORITY_CONFIG,
} from "@/lib/tasks"
import AgentInbox from "@/components/tasks/AgentInbox"
import RunsPanel from "@/components/tasks/RunsPanel"
import { CHIEF_RUNTIME_KEY } from "@/lib/chief-key"

type TasksView = "board" | "inbox"
const TASKS_VIEW_STORAGE_KEY = "dock:tasks-view"

const COLUMN_COLORS: Record<Column, string> = {
  backlog: "#6366f1",
  planning: "#a855f7",
  "in-progress": "#f59e0b",
  "in-review": "#06b6d4",
  done: "#22c55e",
}

const AUTO_REFRESH_INTERVAL = 30_000 // 30 seconds

interface AddTaskFormState {
  title: string
  assignee: Agent
  priority: Priority
}

const INITIAL_FORM: AddTaskFormState = {
  title: "",
  assignee: "unassigned",
  priority: "medium",
}

const BOARD_COLUMNS: Column[] = ["backlog", "planning", "in-progress", "in-review", "done"]

interface PendingActivation {
  task: Task
  newColumn: Column
  budgetInfo: {
    allowed: boolean
    agentName?: string
    spentUsd: number
    budgetUsd: number
    percentUsed: number
    warning: string | null
  } | null
  loading: boolean
  enrichment?: {
    enrichedTitle: string
    enrichedDescription: string
    acceptanceCriteria: string[]
    implementationPlan: string[]
    risks: string[]
  }
  quote?: Task["quote"] | null
  quoteLoading?: boolean
}

interface PlanningDraft {
  title: string
  description: string
  acceptanceCriteria: string
  implementationPlan: string
  risks: string
  conversationId?: string
}

interface GoalOption {
  id: string
  title: string
  priority: "high" | "medium" | "low"
}

const PRIORITY_DOT: Record<string, string> = {
  high: "#ef4444",
  medium: "#f59e0b",
  low: "#22c55e",
}

function timeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000)
  if (seconds < 10) return "just now"
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ago`
}

// ── Task Card ────────────────────────────────────────────────────────────────

interface TaskCardProps {
  task: Task
  accent: string
  isDragging: boolean
  draggableProps: React.HTMLAttributes<HTMLDivElement>
  dragHandleProps: React.HTMLAttributes<HTMLDivElement> | null | undefined
  innerRef: (element: HTMLElement | null) => void
  onDelete: (id: string) => void
  onUpdate: (id: string, updates: Partial<Task>) => void
  goals: GoalOption[]
}

function TaskCard({
  task,
  accent,
  isDragging,
  draggableProps,
  dragHandleProps,
  innerRef,
  onDelete,
  onUpdate,
  goals,
}: TaskCardProps) {
  const [expanded, setExpanded] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editTitle, setEditTitle] = useState(task.title)
  const [editDesc, setEditDesc] = useState(task.description ?? "")
  const [editPriority, setEditPriority] = useState<Priority>(task.priority)
  const [editAssignee, setEditAssignee] = useState<Agent>(task.assignee)
  const [editGoalId, setEditGoalId] = useState<string>(task.goalId ?? "")
  const [saving, setSaving] = useState(false)

  const saveEdit = async () => {
    setSaving(true)
    const patchBody: Record<string, unknown> = {
      title: editTitle,
      description: editDesc,
      priority: editPriority,
      assignee: editAssignee,
      goalId: editGoalId || null,
    }
    const localUpdates: Partial<Task> = {
      title: editTitle,
      description: editDesc,
      priority: editPriority,
      assignee: editAssignee,
      goalId: editGoalId || undefined,
    }
    try {
      await fetch(`/api/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patchBody),
      })
      onUpdate(task.id, localUpdates)
      setEditing(false)
    } finally {
      setSaving(false)
    }
  }

  const hasDescription = Boolean(task.description && task.description.trim().length > 0)
  const linkedGoal = task.goalId ? goals.find((g) => g.id === task.goalId) : null

  return (
    <div
      ref={innerRef}
      {...draggableProps}
      {...dragHandleProps}
      className="group rounded-lg p-4 space-y-3 transition-shadow"
      style={{
        backgroundColor: "#111118",
        borderTop: `1px solid ${isDragging ? `${accent}60` : "#1a1a2e"}`,
        borderRight: `1px solid ${isDragging ? `${accent}60` : "#1a1a2e"}`,
        borderBottom: `1px solid ${isDragging ? `${accent}60` : "#1a1a2e"}`,
        borderLeft: `3px solid ${PRIORITY_CONFIG[task.priority].border}`,
        boxShadow: isDragging ? `0 0 20px ${accent}20` : "none",
        ...(draggableProps as { style?: React.CSSProperties }).style,
      }}
    >
      {/* Demo badge */}
      {task.isDemo && (
        <span
          className="text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full self-start"
          style={{ backgroundColor: "rgba(245,158,11,0.15)", color: "#f59e0b", border: "1px solid rgba(245,158,11,0.25)" }}
        >
          Sample
        </span>
      )}

      {/* Title */}
      <p
        className={[
          "text-sm font-semibold text-white leading-tight",
          hasDescription ? "cursor-pointer hover:text-zinc-300 transition-colors" : "",
        ].join(" ")}
        onClick={hasDescription ? () => setExpanded((v) => !v) : undefined}
        title={hasDescription ? (expanded ? "Click to collapse" : "Click to expand") : undefined}
      >
        {task.title}
        {hasDescription && (
          <span className="ml-1.5 text-zinc-600 text-xs font-normal">
            {expanded ? "▲" : "▼"}
          </span>
        )}
      </p>

      {/* Goal pill */}
      {linkedGoal && (
        <div className="flex items-center gap-1.5">
          <span
            className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full max-w-[180px] truncate"
            style={{ backgroundColor: "rgba(124,58,237,0.18)", color: "#a78bfa", border: "1px solid rgba(124,58,237,0.25)" }}
            title={linkedGoal.title}
          >
            <span
              className="w-1.5 h-1.5 rounded-full shrink-0"
              style={{ backgroundColor: PRIORITY_DOT[linkedGoal.priority] ?? "#a78bfa" }}
            />
            {linkedGoal.title.length > 22
              ? linkedGoal.title.slice(0, 22) + "…"
              : linkedGoal.title}
          </span>
        </div>
      )}

      {/* Expandable description */}
      {hasDescription && (
        <div
          className={[
            "text-xs text-zinc-400 leading-relaxed transition-all overflow-hidden",
            expanded ? "max-h-[500px]" : "max-h-[3.6em]",
          ].join(" ")}
          style={{
            display: "-webkit-box",
            WebkitBoxOrient: expanded ? undefined : "vertical",
            WebkitLineClamp: expanded ? undefined : 3,
            overflow: "hidden",
          } as React.CSSProperties}
        >
          {task.description}
        </div>
      )}

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span
            className="flex items-center justify-center w-6 h-6 rounded-full text-xs"
            style={{ backgroundColor: "#1a1a2e" }}
            title={AGENT_LABELS[task.assignee]}
          >
            {AGENT_EMOJI[task.assignee]}
          </span>
          <span className="text-xs text-zinc-500">
            {AGENT_LABELS[task.assignee]}
          </span>
          <Link
            href={`/conversations?id=task-${task.id}`}
            className="text-[10px] px-2 py-0.5 rounded-full transition-colors hover:bg-white/10"
            style={{ backgroundColor: "rgba(34,211,238,0.12)", color: "#67e8f9", border: "1px solid rgba(34,211,238,0.2)" }}
            onClick={(e) => e.stopPropagation()}
          >
            Thread
          </Link>
        </div>

        <div className="flex items-center gap-2">
          <span
            className="text-xs px-2 py-0.5 rounded-full font-medium"
            style={{
              backgroundColor: `${PRIORITY_CONFIG[task.priority].color}20`,
              color: PRIORITY_CONFIG[task.priority].color,
            }}
          >
            {PRIORITY_CONFIG[task.priority].label}
          </span>
          <button
            onClick={(e) => {
              e.stopPropagation()
              setEditing(true)
              setEditTitle(task.title)
              setEditDesc(task.description ?? "")
              setEditPriority(task.priority)
              setEditAssignee(task.assignee)
              setEditGoalId(task.goalId ?? "")
            }}
            className="opacity-0 group-hover:opacity-100 text-zinc-600 hover:text-zinc-300 transition-all text-xs leading-none px-1"
            title="Edit task"
          >
            ✎
          </button>
          <button
            onClick={async (e) => {
              e.stopPropagation()
              if (deleting) return
              setDeleting(true)
              try {
                await fetch(`/api/tasks/${task.id}`, { method: "DELETE" })
                onDelete(task.id)
              } catch {
                setDeleting(false)
              }
            }}
            className="opacity-0 group-hover:opacity-100 text-zinc-700 hover:text-red-400 transition-all text-xs leading-none px-1"
            title="Delete task"
          >
            {deleting ? "…" : "✕"}
          </button>
        </div>
      </div>

      {/* Edit Modal */}
      {editing && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backgroundColor: "rgba(0,0,0,0.7)" }}
          onClick={(e) => { if (e.target === e.currentTarget) setEditing(false) }}
        >
          <div
            className="w-full max-w-md rounded-xl p-6 space-y-4"
            style={{ backgroundColor: "#111118", border: "1px solid #1a1a2e" }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-bold text-white">Edit Task</h3>

            <div className="space-y-1">
              <label className="text-xs text-zinc-500">Title</label>
              <input
                className="w-full rounded-lg px-3 py-2 text-sm text-white outline-none"
                style={{ backgroundColor: "#0a0a0f", border: "1px solid #1a1a2e" }}
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                autoFocus
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs text-zinc-500">Description</label>
              <textarea
                className="w-full rounded-lg px-3 py-2 text-sm text-white outline-none resize-none"
                style={{ backgroundColor: "#0a0a0f", border: "1px solid #1a1a2e" }}
                rows={5}
                value={editDesc}
                onChange={(e) => setEditDesc(e.target.value)}
                placeholder="Add details, context, or instructions for the agent..."
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs text-zinc-500">Priority</label>
                <select
                  className="w-full rounded-lg px-3 py-2 text-sm text-white outline-none"
                  style={{ backgroundColor: "#0a0a0f", border: "1px solid #1a1a2e" }}
                  value={editPriority}
                  onChange={(e) => setEditPriority(e.target.value as Priority)}
                >
                  <option value="high">High</option>
                  <option value="medium">Medium</option>
                  <option value="low">Low</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs text-zinc-500">Assignee</label>
                <select
                  className="w-full rounded-lg px-3 py-2 text-sm text-white outline-none"
                  style={{ backgroundColor: "#0a0a0f", border: "1px solid #1a1a2e" }}
                  value={editAssignee}
                  onChange={(e) => setEditAssignee(e.target.value as Agent)}
                >
                  <option value={CHIEF_RUNTIME_KEY}>🧭 Chief of staff</option>
                  <option value="scout">🔭 Scout</option>
                  <option value="builder">⚡ Builder</option>
                  <option value="deal-flow">🤝 Deal Flow</option>
                  <option value="baron">🏦 Baron</option>
                  <option value="unassigned">⚪ Unassigned</option>
                </select>
              </div>
            </div>

            {/* Goal dropdown */}
            <div className="space-y-1">
              <label className="text-xs text-zinc-500">Goal</label>
              <select
                className="w-full rounded-lg px-3 py-2 text-sm text-white outline-none"
                style={{ backgroundColor: "#0a0a0f", border: "1px solid #1a1a2e" }}
                value={editGoalId}
                onChange={(e) => setEditGoalId(e.target.value)}
              >
                <option value="">— No goal —</option>
                {goals.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.priority === "high" ? "🔴" : g.priority === "medium" ? "🟡" : "🟢"} {g.title}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex gap-2 pt-1">
              <button
                onClick={saveEdit}
                disabled={saving || !editTitle.trim()}
                className="flex-1 py-2 rounded-lg text-sm font-medium transition-all"
                style={{ backgroundColor: "#7c3aed", color: "white", opacity: saving || !editTitle.trim() ? 0.5 : 1 }}
              >
                {saving ? "Saving…" : "Save"}
              </button>
              <button
                onClick={() => setEditing(false)}
                className="px-4 py-2 rounded-lg text-sm font-medium text-zinc-400 hover:text-white transition-colors"
                style={{ backgroundColor: "#1a1a2e" }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {task.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {task.tags.map((tag) => (
            <span
              key={tag}
              className="text-xs px-2 py-0.5 rounded-full"
              style={{ backgroundColor: "#1a1a2e", color: "#71717a" }}
            >
              {tag}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function TasksPage() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [goals, setGoals] = useState<GoalOption[]>([])
  const [loading, setLoading] = useState(true)
  const [addingTo, setAddingTo] = useState<Column | null>(null)
  const [form, setForm] = useState<AddTaskFormState>(INITIAL_FORM)
  const [quickIdea, setQuickIdea] = useState("")
  const [draftingIdea, setDraftingIdea] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [pendingActivation, setPendingActivation] = useState<PendingActivation | null>(null)
  const [planningDraft, setPlanningDraft] = useState<PlanningDraft | null>(null)
  const [activating, setActivating] = useState(false)
  const [budgetError, setBudgetError] = useState<string | null>(null)
  const [quoteRail, setQuoteRail] = useState<"shipusd" | "usdc">("shipusd")
  const [demoMode, setDemoMode] = useState(false)
  const [view, setViewState] = useState<TasksView>("board")
  const [, setTick] = useState(0)
  const tasksSnapshotRef = useRef<string>("")

  const fetchTasks = useCallback(async (silent = false) => {
    try {
      const res = await fetch("/api/tasks")
      const data: Task[] = await res.json()
      const snapshot = JSON.stringify(data)

      if (snapshot !== tasksSnapshotRef.current) {
        tasksSnapshotRef.current = snapshot
        setTasks(data)
        setLastUpdated(new Date())
      }
    } catch {
      if (!silent) setTasks([])
    } finally {
      if (!silent) setLoading(false)
    }
  }, [])

  const fetchGoals = useCallback(async () => {
    try {
      const res = await fetch("/api/company/goals")
      const data = await res.json() as Array<{ id: string; title: string; priority: "high" | "medium" | "low" }>
      if (Array.isArray(data)) {
        setGoals(data.map((g) => ({ id: g.id, title: g.title, priority: g.priority })))
      }
    } catch {
      // non-fatal
    }
  }, [])

  useEffect(() => {
    fetchTasks(false)
    fetchGoals()
    fetch("/api/setup/status")
      .then((r) => r.json())
      .then((d: { demoMode?: boolean }) => { if (d.demoMode) setDemoMode(true) })
      .catch(() => null)
  }, [fetchTasks, fetchGoals])

  useEffect(() => {
    const interval = setInterval(() => fetchTasks(true), AUTO_REFRESH_INTERVAL)
    return () => clearInterval(interval)
  }, [fetchTasks])

  useEffect(() => {
    const interval = setInterval(() => setTick((n) => n + 1), 15_000)
    return () => clearInterval(interval)
  }, [])

  // Board is the default; the chosen view is remembered per browser.
  useEffect(() => {
    try {
      if (window.localStorage.getItem(TASKS_VIEW_STORAGE_KEY) === "inbox") setViewState("inbox")
    } catch {
      // storage unavailable: stay on Board
    }
  }, [])

  const setView = (next: TasksView) => {
    setViewState(next)
    try {
      window.localStorage.setItem(TASKS_VIEW_STORAGE_KEY, next)
    } catch {
      // ignore
    }
  }

  const onDragEnd = async (result: DropResult) => {
    const { draggableId, destination } = result
    if (!destination) return

    const newColumn = destination.droppableId as Column
    const task = tasks.find((t) => t.id === draggableId)
    if (!task || task.column === newColumn) return

    // If moving from backlog to planning, keep it in planning first
    if (newColumn === "planning" && task.column === "backlog") {
      setTasks((prev) => prev.map((t) => (t.id === draggableId ? { ...t, column: newColumn } : t)))
      setLastUpdated(new Date())
      try {
        await fetch(`/api/tasks/${task.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ column: newColumn }),
        })
      } catch {
        setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, column: task.column } : t)))
      }
      return
    }

    // If moving to in-progress, show approval gate first
    if (newColumn === "in-progress" && task.column !== "in-progress") {
      // Optimistically move the card
      setTasks((prev) =>
        prev.map((t) => (t.id === draggableId ? { ...t, column: newColumn } : t))
      )
      setLastUpdated(new Date())

      // Fetch budget info and show modal
      const enrichment = {
        enrichedTitle: task.enrichedTitle ?? task.title,
        enrichedDescription: task.enrichedDescription ?? task.description ?? "",
        acceptanceCriteria: task.acceptanceCriteria ?? [],
        implementationPlan: task.implementationPlan ?? [],
        risks: task.risks ?? [],
      }
      setPendingActivation({
        task,
        newColumn,
        budgetInfo: null,
        loading: !demoMode && newColumn === "in-progress" && task.assignee !== "unassigned",
        enrichment,
      })
      setPlanningDraft({
        title: enrichment.enrichedTitle,
        description: enrichment.enrichedDescription,
        acceptanceCriteria: enrichment.acceptanceCriteria.join("\n"),
        implementationPlan: enrichment.implementationPlan.join("\n"),
        risks: enrichment.risks.join("\n"),
      })


      // Fetch budget check in background
      if (task.assignee !== "unassigned") {
        try {
          const res = await fetch(`/api/company/budgets/check?agent=${encodeURIComponent(task.assignee)}`)
          const budget = await res.json()
          setPendingActivation((prev) =>
            prev ? { ...prev, budgetInfo: budget, loading: false } : null
          )
        } catch {
          setPendingActivation((prev) =>
            prev ? { ...prev, loading: false } : null
          )
        }
      } else {
        setPendingActivation((prev) =>
          prev ? { ...prev, loading: false } : null
        )
      }

      // Fetch the Buoy quoted plan in background (quote IS the approval UX)
      if (task.toolNeeds && task.toolNeeds.length > 0) {
        setPendingActivation((prev) => (prev ? { ...prev, quoteLoading: true } : null))
        try {
          const qres = await fetch(`/api/tasks/${task.id}/quote`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "refresh" }),
          })
          const qdata = await qres.json()
          setPendingActivation((prev) =>
            prev && prev.task.id === task.id
              ? { ...prev, quote: qdata.task?.quote ?? null, quoteLoading: false }
              : null
          )
        } catch {
          setPendingActivation((prev) =>
            prev && prev.task.id === task.id ? { ...prev, quoteLoading: false } : null
          )
        }
      }
      return
    }

    // Non-in-progress moves: proceed directly
    setTasks((prev) =>
      prev.map((t) => (t.id === draggableId ? { ...t, column: newColumn } : t))
    )
    setLastUpdated(new Date())

    try {
      await fetch(`/api/tasks/${draggableId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ column: newColumn }),
      })
    } catch {
      fetchTasks(false)
    }
  }

  const planningReady = Boolean(
    planningDraft?.title.trim() &&
    planningDraft?.description.trim() &&
    planningDraft?.implementationPlan.split(/\n+/).map((s) => s.trim()).filter(Boolean).length > 0
  )

  const confirmActivation = async () => {
    if (!pendingActivation) return
    setActivating(true)
    setBudgetError(null)

    const { task, newColumn } = pendingActivation
    const draft = planningDraft ?? {
      title: task.enrichedTitle ?? task.title,
      description: task.enrichedDescription ?? task.description ?? "",
      acceptanceCriteria: (task.acceptanceCriteria ?? []).join("\n"),
      implementationPlan: (task.implementationPlan ?? []).join("\n"),
      risks: (task.risks ?? []).join("\n"),
    }

    const parsedAcceptanceCriteria = draft.acceptanceCriteria.split(/\n+/).map((s) => s.trim()).filter(Boolean)
    const parsedImplementationPlan = draft.implementationPlan.split(/\n+/).map((s) => s.trim()).filter(Boolean)
    const parsedRisks = draft.risks.split(/\n+/).map((s) => s.trim()).filter(Boolean)

    try {
      // Approve the tool-spend quote first (one approval = whole plan settles)
      if (pendingActivation.quote && !pendingActivation.task.jobId) {
        try {
          await fetch(`/api/tasks/${task.id}/quote`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "approve", rail: quoteRail }),
          })
        } catch {
          // Non-fatal — agent activation proceeds; quote can be approved later
        }
      }

      // Persist planning draft and column move
      await fetch(`/api/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          column: newColumn,
          enrichedTitle: draft.title,
          enrichedDescription: draft.description,
          acceptanceCriteria: parsedAcceptanceCriteria,
          implementationPlan: parsedImplementationPlan,
          risks: parsedRisks,
        }),
      })

      // Fire agent activation
      const activateRes = await fetch("/api/tasks/activate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskId: task.id,
          title: pendingActivation.enrichment?.enrichedTitle ?? task.title,
          description: pendingActivation.enrichment?.enrichedDescription ?? task.description,
          assignee: task.assignee,
          priority: task.priority,
        }),
      })

      if (!activateRes.ok) {
        const err = await activateRes.json()
        if (activateRes.status === 403) {
          setBudgetError(`${err.agent} is over budget ($${err.spentUsd}/$${err.budgetUsd})`)
          // Revert to original column
          setTasks((prev) =>
            prev.map((t) => (t.id === task.id ? { ...t, column: task.column } : t))
          )
          await fetch(`/api/tasks/${task.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ column: task.column }),
          })
          setActivating(false)
          return
        }
      }

      setPendingActivation(null)
    } catch {
      fetchTasks(false)
    } finally {
      setActivating(false)
    }
  }

  const moveWithoutActivating = async () => {
    if (!pendingActivation) return
    const { task, newColumn } = pendingActivation

    try {
      await fetch(`/api/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ column: newColumn }),
      })
    } catch {
      fetchTasks(false)
    }

    setPendingActivation(null)
    setPlanningDraft(null)
    setBudgetError(null)
  }

  const cancelActivation = async () => {
    if (!pendingActivation) return
    const { task } = pendingActivation

    // Revert to original column
    setTasks((prev) =>
      prev.map((t) => (t.id === task.id ? { ...t, column: task.column } : t))
    )
    setPendingActivation(null)
    setPlanningDraft(null)
    setBudgetError(null)
  }

  const handleQuickIdea = async () => {
    if (!quickIdea.trim()) return
    setDraftingIdea(true)
    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: quickIdea.trim(),
          description: quickIdea.trim(),
          column: "planning",
          priority: "medium",
          assignee: CHIEF_RUNTIME_KEY,
          tags: ["chat-first"],
        }),
      })
      const newTask: Task = await res.json()
      const conversationId = newTask.column === "planning" ? `task-${newTask.id}` : undefined
      setTasks((prev) => [...prev, newTask])
      setLastUpdated(new Date())
      setQuickIdea("")
      setPendingActivation({
        task: newTask,
        newColumn: "planning",
        budgetInfo: null,
        loading: false,
        enrichment: {
          enrichedTitle: newTask.enrichedTitle ?? newTask.title,
          enrichedDescription: newTask.enrichedDescription ?? newTask.description ?? "",
          acceptanceCriteria: newTask.acceptanceCriteria ?? [],
          implementationPlan: newTask.implementationPlan ?? [],
          risks: newTask.risks ?? [],
        },
      })
      setPlanningDraft({
        title: newTask.enrichedTitle ?? newTask.title,
        description: newTask.enrichedDescription ?? newTask.description ?? "",
        acceptanceCriteria: (newTask.acceptanceCriteria ?? []).join("\n"),
        implementationPlan: (newTask.implementationPlan ?? []).join("\n"),
        risks: (newTask.risks ?? []).join("\n"),
        conversationId,
      })
    } finally {
      setDraftingIdea(false)
    }
  }

  const handleAddTask = async (column: Column) => {
    if (!form.title.trim()) return

    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: form.title,
          column,
          priority: form.priority,
          assignee: form.assignee,
          tags: [],
        }),
      })
      const newTask: Task = await res.json()
      setTasks((prev) => [...prev, newTask])
      setLastUpdated(new Date())
      setForm(INITIAL_FORM)
      setAddingTo(null)
    } catch {
      // silently fail
    }
  }

  const tasksByColumn = (column: Column) =>
    tasks.filter((t) => t.column === column)

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <p className="text-zinc-500">Loading tasks...</p>
      </div>
    )
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-3xl font-bold text-white">Tasks</h1>
          <p className="text-sm text-zinc-600">
            The chief of staff delegates. Agents execute.
          </p>
        </div>
        <div className="flex items-center gap-4 pb-1">
          <div
            role="tablist"
            aria-label="Tasks view"
            className="flex gap-1 rounded-lg p-1"
            style={{ background: "#0d0d12", border: "1px solid #1c1c25" }}
          >
            {(["board", "inbox"] as const).map((v) => (
              <button
                key={v}
                type="button"
                role="tab"
                aria-selected={view === v}
                onClick={() => setView(v)}
                className="rounded-md px-3 py-1 text-xs font-medium transition-colors"
                style={{
                  background: view === v ? "#17171f" : "transparent",
                  color: view === v ? "#e9eaf0" : "#62657a",
                }}
              >
                {v === "board" ? "Board" : "Inbox"}
              </button>
            ))}
          </div>
          {lastUpdated && (
            <p className="text-xs text-zinc-600">
              Updated {timeAgo(lastUpdated)}
            </p>
          )}
        </div>
      </div>

      <section className="rounded-xl border border-zinc-800 bg-[#111118] p-4 space-y-3">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">Chat first</p>
            <p className="mt-1 text-sm text-zinc-300">Drop a rough idea and the chief of staff will turn it into a Planning draft.</p>
          </div>
          <span className="rounded-full border border-fuchsia-500/20 bg-fuchsia-500/10 px-2 py-1 text-[10px] text-fuchsia-300">Backlog → Planning</span>
        </div>
        <div className="flex gap-2">
          <textarea
            value={quickIdea}
            onChange={(e) => setQuickIdea(e.target.value)}
            placeholder="e.g. add a lightweight Telegram onboarding check for each user"
            rows={2}
            className="flex-1 rounded-lg border border-zinc-800 bg-black/20 px-3 py-2 text-sm text-white outline-none focus:border-fuchsia-500/50"
          />
          <button
            onClick={handleQuickIdea}
            disabled={draftingIdea || !quickIdea.trim()}
            className="rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50"
            style={{ backgroundColor: "#7c3aed", color: "white" }}
          >
            {draftingIdea ? "Drafting..." : "Draft with chief of staff"}
          </button>
        </div>
      </section>

      {view === "inbox" ? (
        <>
          <RunsPanel />
          <AgentInbox tasks={tasks} onRefresh={() => fetchTasks(true)} />
        </>
      ) : (
      <DragDropContext onDragEnd={onDragEnd}>
        <div
          className="flex gap-4 overflow-x-auto pb-4 -mx-1 px-1"
          style={{ scrollSnapType: "x mandatory" }}
        >
          {COLUMNS.map(({ id: colId, label }) => {
            const colTasks = tasksByColumn(colId)
            const accent = COLUMN_COLORS[colId]

            return (
              <div
                key={colId}
                className="space-y-3 shrink-0"
                style={{ width: "280px", scrollSnapAlign: "start" }}
              >
                {/* Column Header */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <h2
                      className="text-sm font-semibold uppercase tracking-wider"
                      style={{ color: accent }}
                    >
                      {label}
                    </h2>
                    <span
                      className="text-xs px-2 py-0.5 rounded-full font-medium"
                      style={{
                        backgroundColor: `${accent}20`,
                        color: accent,
                      }}
                    >
                      {colTasks.length}
                    </span>
                  </div>
                </div>

                {/* Droppable Column */}
                <Droppable droppableId={colId}>
                  {(provided, snapshot) => (
                    <div
                      ref={provided.innerRef}
                      {...provided.droppableProps}
                      className="space-y-3 min-h-[200px] rounded-lg p-2 transition-colors"
                      style={{
                        backgroundColor: snapshot.isDraggingOver
                          ? `${accent}08`
                          : "transparent",
                      }}
                    >
                      {colTasks.map((task, index) => (
                        <Draggable
                          key={task.id}
                          draggableId={task.id}
                          index={index}
                        >
                          {(provided, snapshot) => (
                            <TaskCard
                              task={task}
                              accent={accent}
                              isDragging={snapshot.isDragging}
                              draggableProps={provided.draggableProps}
                              dragHandleProps={provided.dragHandleProps}
                              innerRef={provided.innerRef}
                              onDelete={(id) => setTasks((prev) => prev.filter((t) => t.id !== id))}
                              onUpdate={(id, updates) => setTasks((prev) => prev.map((t) => t.id === id ? { ...t, ...updates } : t))}
                              goals={goals}
                            />
                          )}
                        </Draggable>
                      ))}
                      {provided.placeholder}
                    </div>
                  )}
                </Droppable>

                {/* Add Task */}
                {addingTo === colId ? (
                  <div
                    className="rounded-lg p-3 space-y-2"
                    style={{
                      backgroundColor: "#111118",
                      border: "1px solid #1a1a2e",
                    }}
                  >
                    <input
                      type="text"
                      placeholder="Task title..."
                      value={form.title}
                      onChange={(e) =>
                        setForm({ ...form, title: e.target.value })
                      }
                      className="w-full bg-transparent text-sm text-white placeholder-zinc-600 outline-none border-b border-zinc-800 pb-2"
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleAddTask(colId)
                        if (e.key === "Escape") {
                          setAddingTo(null)
                          setForm(INITIAL_FORM)
                        }
                      }}
                    />
                    <div className="flex gap-2">
                      <select
                        value={form.assignee}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            assignee: e.target.value as Agent,
                          })
                        }
                        className="flex-1 text-xs bg-[#0a0a0f] text-zinc-400 border border-zinc-800 rounded px-2 py-1 outline-none"
                      >
                        {(Object.keys(AGENT_LABELS) as Agent[]).map((a) => (
                          <option key={a} value={a}>
                            {AGENT_EMOJI[a]} {AGENT_LABELS[a]}
                          </option>
                        ))}
                      </select>
                      <select
                        value={form.priority}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            priority: e.target.value as Priority,
                          })
                        }
                        className="flex-1 text-xs bg-[#0a0a0f] text-zinc-400 border border-zinc-800 rounded px-2 py-1 outline-none"
                      >
                        <option value="high">High</option>
                        <option value="medium">Medium</option>
                        <option value="low">Low</option>
                      </select>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleAddTask(colId)}
                        className="flex-1 text-xs font-medium py-1.5 rounded"
                        style={{
                          backgroundColor: `${accent}20`,
                          color: accent,
                        }}
                      >
                        Add
                      </button>
                      <button
                        onClick={() => {
                          setAddingTo(null)
                          setForm(INITIAL_FORM)
                        }}
                        className="flex-1 text-xs font-medium py-1.5 rounded text-zinc-500 hover:text-zinc-300"
                        style={{ backgroundColor: "#1a1a2e" }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => {
                      setAddingTo(colId)
                      setForm(INITIAL_FORM)
                    }}
                    className="w-full text-xs text-zinc-600 hover:text-zinc-400 py-2 rounded-lg transition-colors"
                    style={{ border: "1px dashed #1a1a2e" }}
                  >
                    + Add Task
                  </button>
                )}
              </div>
            )
          })}
        </div>
      </DragDropContext>
      )}

      {/* ── Activation Approval Modal ────────────────────────────────── */}
      {pendingActivation && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backgroundColor: "rgba(0,0,0,0.7)" }}
          onClick={(e) => { if (e.target === e.currentTarget) cancelActivation() }}
        >
          <div
            className="w-full max-w-md rounded-xl p-6 space-y-4"
            style={{ backgroundColor: "#111118", border: "1px solid #1a1a2e" }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-bold text-white uppercase tracking-wider" style={{ color: "#a855f7" }}>
              {pendingActivation.task.column === "planning" ? "Planning Mode" : "Activate Agent"}
            </h3>

            {/* Task info */}
            {pendingActivation.task.column === "planning" && (
              <div className="rounded-lg border border-zinc-800 bg-black/20 p-3 text-xs text-zinc-400 space-y-2">
                <p>Refine the idea here. When the plan looks right, hit Go to move this into In Progress and spin up the agent.</p>
                <p className="text-[11px] text-zinc-500">Ready to Go when title, description, and at least one implementation step are filled.</p>
                {planningDraft?.conversationId && (
                  <Link href={`/conversations?id=${planningDraft.conversationId}`} className="inline-flex rounded-full border border-fuchsia-500/20 bg-fuchsia-500/10 px-2 py-1 text-[11px] text-fuchsia-300 hover:bg-fuchsia-500/15">
                    Open chief of staff thread
                  </Link>
                )}
              </div>
            )}
            <div className="space-y-2">
              {pendingActivation.enrichment && (
                <div className="rounded-lg border border-zinc-800 bg-black/20 p-3 space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">Chief of staff summary</p>
                    <span className="text-[10px] text-zinc-600">Generated brief</span>
                  </div>
                  <p className="text-sm text-white leading-5">{pendingActivation.enrichment.enrichedDescription}</p>
                  <p className="text-[11px] text-zinc-500">
                    {pendingActivation.enrichment.acceptanceCriteria.slice(0, 2).join(" • ")}
                  </p>
                </div>
              )}
              <label className="block space-y-1">
                <span className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">Plan title</span>
                <input
                  value={planningDraft?.title ?? pendingActivation.enrichment?.enrichedTitle ?? pendingActivation.task.title}
                  onChange={(e) => setPlanningDraft((prev) => ({
                    title: e.target.value,
                    description: prev?.description ?? pendingActivation.enrichment?.enrichedDescription ?? pendingActivation.task.description ?? "",
                    acceptanceCriteria: prev?.acceptanceCriteria ?? (pendingActivation.enrichment?.acceptanceCriteria ?? []).join("\n"),
                    implementationPlan: prev?.implementationPlan ?? (pendingActivation.enrichment?.implementationPlan ?? []).join("\n"),
                    risks: prev?.risks ?? (pendingActivation.enrichment?.risks ?? []).join("\n"),
                  }))}
                  className="w-full rounded-lg border border-zinc-800 bg-black/20 px-3 py-2 text-sm text-white outline-none focus:border-fuchsia-500/50"
                />
              </label>
              <label className="block space-y-1">
                <span className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">Problem statement</span>
                <textarea
                  rows={3}
                  value={planningDraft?.description ?? pendingActivation.enrichment?.enrichedDescription ?? pendingActivation.task.description ?? ""}
                  onChange={(e) => setPlanningDraft((prev) => ({
                    title: prev?.title ?? pendingActivation.enrichment?.enrichedTitle ?? pendingActivation.task.title,
                    description: e.target.value,
                    acceptanceCriteria: prev?.acceptanceCriteria ?? (pendingActivation.enrichment?.acceptanceCriteria ?? []).join("\n"),
                    implementationPlan: prev?.implementationPlan ?? (pendingActivation.enrichment?.implementationPlan ?? []).join("\n"),
                    risks: prev?.risks ?? (pendingActivation.enrichment?.risks ?? []).join("\n"),
                  }))}
                  className="w-full rounded-lg border border-zinc-800 bg-black/20 px-3 py-2 text-sm text-white outline-none focus:border-fuchsia-500/50"
                />
              </label>
              <label className="block space-y-1">
                <span className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">First steps</span>
                <textarea
                  rows={3}
                  placeholder="One step per line"
                  value={planningDraft?.implementationPlan ?? (pendingActivation.enrichment?.implementationPlan ?? []).join("\n")}
                  onChange={(e) => setPlanningDraft((prev) => ({
                    title: prev?.title ?? pendingActivation.enrichment?.enrichedTitle ?? pendingActivation.task.title,
                    description: prev?.description ?? pendingActivation.enrichment?.enrichedDescription ?? pendingActivation.task.description ?? "",
                    acceptanceCriteria: prev?.acceptanceCriteria ?? (pendingActivation.enrichment?.acceptanceCriteria ?? []).join("\n"),
                    implementationPlan: e.target.value,
                    risks: prev?.risks ?? (pendingActivation.enrichment?.risks ?? []).join("\n"),
                  }))}
                  className="w-full rounded-lg border border-zinc-800 bg-black/20 px-3 py-2 text-sm text-white outline-none focus:border-fuchsia-500/50"
                />
              </label>
              <div className="grid gap-3 md:grid-cols-2">
                <label className="block space-y-1">
                  <span className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">Acceptance criteria</span>
                  <textarea
                    rows={4}
                    placeholder="One criterion per line"
                    value={planningDraft?.acceptanceCriteria ?? (pendingActivation.enrichment?.acceptanceCriteria ?? []).join("\n")}
                    onChange={(e) => setPlanningDraft((prev) => ({
                      title: prev?.title ?? pendingActivation.enrichment?.enrichedTitle ?? pendingActivation.task.title,
                      description: prev?.description ?? pendingActivation.enrichment?.enrichedDescription ?? pendingActivation.task.description ?? "",
                      acceptanceCriteria: e.target.value,
                      implementationPlan: prev?.implementationPlan ?? (pendingActivation.enrichment?.implementationPlan ?? []).join("\n"),
                      risks: prev?.risks ?? (pendingActivation.enrichment?.risks ?? []).join("\n"),
                    }))}
                    className="w-full rounded-lg border border-zinc-800 bg-black/20 px-3 py-2 text-sm text-white outline-none focus:border-fuchsia-500/50"
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">Risks / unknowns</span>
                  <textarea
                    rows={4}
                    placeholder="One risk per line"
                    value={planningDraft?.risks ?? (pendingActivation.enrichment?.risks ?? []).join("\n")}
                    onChange={(e) => setPlanningDraft((prev) => ({
                      title: prev?.title ?? pendingActivation.enrichment?.enrichedTitle ?? pendingActivation.task.title,
                      description: prev?.description ?? pendingActivation.enrichment?.enrichedDescription ?? pendingActivation.task.description ?? "",
                      acceptanceCriteria: prev?.acceptanceCriteria ?? (pendingActivation.enrichment?.acceptanceCriteria ?? []).join("\n"),
                      implementationPlan: prev?.implementationPlan ?? (pendingActivation.enrichment?.implementationPlan ?? []).join("\n"),
                      risks: e.target.value,
                    }))}
                    className="w-full rounded-lg border border-zinc-800 bg-black/20 px-3 py-2 text-sm text-white outline-none focus:border-fuchsia-500/50"
                  />
                </label>
              </div>
            </div>

            {/* Agent + Priority row */}
            <div className="flex items-center gap-3">
              <span
                className="flex items-center gap-2 text-sm px-3 py-1.5 rounded-lg"
                style={{ backgroundColor: "#1a1a2e" }}
              >
                <span>{AGENT_EMOJI[pendingActivation.task.assignee]}</span>
                <span className="text-zinc-300">{AGENT_LABELS[pendingActivation.task.assignee]}</span>
              </span>
              <span
                className="text-xs px-2 py-1 rounded-full font-medium"
                style={{
                  backgroundColor: `${PRIORITY_CONFIG[pendingActivation.task.priority].color}20`,
                  color: PRIORITY_CONFIG[pendingActivation.task.priority].color,
                }}
              >
                {PRIORITY_CONFIG[pendingActivation.task.priority].label}
              </span>
            </div>

            {/* Demo mode notice */}
            {demoMode && (
              <div
                className="rounded-lg p-3 text-xs"
                style={{ backgroundColor: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.25)", color: "#f59e0b" }}
              >
                <p className="font-medium mb-1">Demo Mode</p>
                <p className="text-zinc-400">No agent runtime connected. Use &quot;Move Only&quot; to organize tasks, or connect a runtime in Settings to activate agents.</p>
              </div>
            )}

            {/* Tool spend quote — approve once, whole plan settles */}
            {!demoMode && (pendingActivation.quoteLoading || pendingActivation.quote) && (
              <div
                className="rounded-lg p-3 text-xs space-y-2"
                style={{ backgroundColor: "#0a0a0f", border: "1px solid #a855f740" }}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">Tool spend</span>
                  {pendingActivation.quote && (
                    <span className="text-white font-semibold">
                      ${(pendingActivation.quote.totalUsd / 1_000_000).toFixed(2)}
                    </span>
                  )}
                </div>
                {pendingActivation.quoteLoading ? (
                  <div className="text-zinc-500 py-1">Quoting plan against Buoy catalog...</div>
                ) : pendingActivation.quote && (
                  <>
                    {pendingActivation.quote.steps.map((step, i) => (
                      <div key={i} className="flex items-center justify-between gap-2 text-zinc-400">
                        <span className="truncate">
                          {step.serviceName ?? step.serviceId}
                          <span className="text-zinc-600"> · {step.name}</span>
                        </span>
                        <span className="text-zinc-300 shrink-0">
                          ${(step.amountUsd / 1_000_000).toFixed(2)}
                        </span>
                      </div>
                    ))}
                    {!pendingActivation.task.jobId && (
                      <div className="flex items-center gap-1.5 pt-1">
                        {(["shipusd", "usdc"] as const).map((rail) => (
                          <button
                            key={rail}
                            onClick={() => setQuoteRail(rail)}
                            className="px-2 py-1 rounded-md text-[10px] font-medium transition-colors"
                            style={{
                              backgroundColor: quoteRail === rail ? "#a855f7" : "#1a1a2e",
                              color: quoteRail === rail ? "#0a0a0f" : "#a1a1aa",
                            }}
                          >
                            {rail === "shipusd" ? "Pay with SHIPusd" : "Pay with USDC"}
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {/* Budget status */}
            {!demoMode && pendingActivation.loading ? (
              <div className="text-xs text-zinc-500 py-2">Checking budget...</div>
            ) : !demoMode && pendingActivation.budgetInfo && pendingActivation.budgetInfo.budgetUsd > 0 ? (
              <div
                className="rounded-lg p-3 text-xs space-y-1"
                style={{
                  backgroundColor: "#0a0a0f",
                  border: `1px solid ${
                    !pendingActivation.budgetInfo.allowed
                      ? "#ef444440"
                      : pendingActivation.budgetInfo.warning
                      ? "#f59e0b40"
                      : "#22c55e40"
                  }`,
                }}
              >
                <div className="flex justify-between">
                  <span className="text-zinc-400">Monthly budget</span>
                  <span className="text-zinc-300">
                    ${pendingActivation.budgetInfo.spentUsd} / ${pendingActivation.budgetInfo.budgetUsd}
                  </span>
                </div>
                <div className="w-full h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: "#1a1a2e" }}>
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${Math.min(pendingActivation.budgetInfo.percentUsed, 100)}%`,
                      backgroundColor: !pendingActivation.budgetInfo.allowed
                        ? "#ef4444"
                        : pendingActivation.budgetInfo.warning
                        ? "#f59e0b"
                        : "#22c55e",
                    }}
                  />
                </div>
                {!pendingActivation.budgetInfo.allowed && (
                  <p className="text-red-400 font-medium mt-1">Budget exceeded — activation blocked</p>
                )}
                {pendingActivation.budgetInfo.warning && (
                  <p className="text-amber-400 mt-1">Approaching budget limit ({pendingActivation.budgetInfo.percentUsed}% used)</p>
                )}
              </div>
            ) : null}

            {/* Budget error */}
            {budgetError && (
              <div
                className="rounded-lg p-3 text-xs"
                style={{ backgroundColor: "#2d0a0a", border: "1px solid #ef444440", color: "#ef4444" }}
              >
                {budgetError}
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-2 pt-1">
              {!demoMode && (
                <button
                  onClick={confirmActivation}
                  disabled={
                    activating ||
                    (pendingActivation.task.column === "planning" && !planningReady) ||
                    (pendingActivation.budgetInfo !== null && !pendingActivation.budgetInfo.allowed)
                  }
                  className="flex-1 py-2.5 rounded-lg text-sm font-medium transition-all"
                  style={{
                    backgroundColor:
                      pendingActivation.budgetInfo && !pendingActivation.budgetInfo.allowed
                        ? "#3f3f46"
                        : "#f59e0b",
                    color:
                      pendingActivation.budgetInfo && !pendingActivation.budgetInfo.allowed
                        ? "#71717a"
                        : "#0a0a0f",
                    opacity: activating ? 0.7 : 1,
                    cursor:
                      pendingActivation.budgetInfo && !pendingActivation.budgetInfo.allowed
                        ? "not-allowed"
                        : "pointer",
                  }}
                >
                  {activating ? "Going..." : pendingActivation.task.column === "planning" ? (planningReady ? "Go" : "Fill Plan to Go") : "Activate Agent"}
                </button>
              )}
              <button
                onClick={moveWithoutActivating}
                className={`${demoMode ? "flex-1" : ""} px-3 py-2.5 rounded-lg text-xs font-medium transition-colors`}
                style={demoMode
                  ? { backgroundColor: "#f59e0b", color: "#0a0a0f", fontWeight: 600, fontSize: 14 }
                  : { backgroundColor: "#1a1a2e", color: "#a1a1aa" }}
                title="Move to In Progress without triggering agent"
              >
                {demoMode ? "Move Task" : "Move Only"}
              </button>
              <button
                onClick={cancelActivation}
                className="px-3 py-2.5 rounded-lg text-xs font-medium text-zinc-500 hover:text-zinc-300 transition-colors"
                style={{ backgroundColor: "#1a1a2e" }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
