"use client"

import { useEffect, useState, useCallback } from "react"
import Link from "next/link"

// ── Types ──────────────────────────────────────────────────────────────────────

interface AgentBudget {
  name: string
  emoji: string
  accent: string
  spentUsd: number
  budgetUsd: number
  tokens: number
}

interface GoalProgress {
  total: number
  done: number
  percent: number
}

interface Goal {
  id: string
  title: string
  description?: string
  status: "active" | "completed" | "paused"
  priority: "high" | "medium" | "low"
  assignedTo?: string
  createdAt?: string
  taskIds: string[]
  progress: GoalProgress
}

interface TaskSummary {
  id: string
  title: string
  column: string
}

// ── Constants ──────────────────────────────────────────────────────────────────

const AGENT_EMOJI: Record<string, string> = {
  scout: "🔭",
  builder: "⚡",
  "deal-flow": "🤝",
  baron: "🏦",
}

const PRIORITY_COLOR: Record<string, string> = {
  high: "#ef4444",
  medium: "#f59e0b",
  low: "#22c55e",
}

const STATUS_CYCLE: Record<Goal["status"], Goal["status"]> = {
  active: "completed",
  completed: "paused",
  paused: "active",
}

const STATUS_STYLE: Record<Goal["status"], { bg: string; color: string; label: string }> = {
  active: { bg: "rgba(16,185,129,0.15)", color: "#10b981", label: "Active" },
  completed: { bg: "rgba(34,197,94,0.12)", color: "#22c55e", label: "Done" },
  paused: { bg: "rgba(113,113,122,0.15)", color: "#71717a", label: "Paused" },
}

const COLUMN_DOT: Record<string, string> = {
  backlog: "#71717a",
  planning: "#a855f7",
  "in-progress": "#3b82f6",
  "in-review": "#f59e0b",
  done: "#22c55e",
}

// ── Budget progress bar color ──────────────────────────────────────────────────

function budgetColor(pct: number): string {
  if (pct >= 85) return "#ef4444"
  if (pct >= 60) return "#f59e0b"
  return "#22c55e"
}

// ── Org Chart ─────────────────────────────────────────────────────────────────

function OrgChart({ userName, chiefAgent, otherAgents }: {
  userName: string
  chiefAgent: AgentInfo | null
  otherAgents: AgentInfo[]
}) {
  return (
    <div className="flex flex-col items-center gap-0">
      {/* Owner */}
      <div
        className="rounded-xl px-6 py-4 flex flex-col items-center gap-1 min-w-[160px]"
        style={{ backgroundColor: "#1a1a2e", border: "1px solid #2a2a4e" }}
      >
        <span className="text-2xl">👤</span>
        <p className="text-sm font-bold text-white">{userName || "You"}</p>
        <p className="text-[11px] text-zinc-400">Owner</p>
      </div>

      <div className="w-px h-6" style={{ backgroundColor: "#2a2a4e" }} />

      {/* Chief of Staff */}
      {chiefAgent && (
        <div
          className="rounded-xl px-6 py-4 flex flex-col items-center gap-1 min-w-[180px]"
          style={{
            backgroundColor: "#1a1a2e",
            border: `1px solid ${chiefAgent.accent}66`,
            boxShadow: `0 0 20px ${chiefAgent.accent}1a`,
          }}
        >
          <span className="text-2xl">{chiefAgent.emoji}</span>
          <p className="text-sm font-bold" style={{ color: chiefAgent.accent }}>{chiefAgent.name}</p>
          <p className="text-[11px] text-zinc-400">{chiefAgent.role}</p>
        </div>
      )}

      {otherAgents.length > 0 && (
        <>
          <div className="w-px h-6" style={{ backgroundColor: "#2a2a4e" }} />

          {/* Horizontal connector spanning agent row */}
          <div className="relative flex items-start justify-center w-full max-w-2xl">
            <div
              className="absolute top-0 left-[12.5%] right-[12.5%] h-px"
              style={{ backgroundColor: "#2a2a4e" }}
            />

            <div className={`grid grid-cols-2 ${otherAgents.length >= 4 ? "md:grid-cols-4" : `md:grid-cols-${Math.min(otherAgents.length, 4)}`} gap-3 w-full pt-6`}>
              {otherAgents.map((agent) => (
                <div key={agent.id} className="flex flex-col items-center gap-0">
                  <div className="w-px h-6" style={{ backgroundColor: "#2a2a4e" }} />
                  <div
                    className="rounded-xl px-3 py-4 flex flex-col items-center gap-1 w-full"
                    style={{
                      backgroundColor: "#1a1a2e",
                      border: `1px solid ${agent.accent}33`,
                      boxShadow: `0 0 12px ${agent.accent}0d`,
                    }}
                  >
                    <span className="text-2xl">{agent.emoji}</span>
                    <p className="text-xs font-bold" style={{ color: agent.accent }}>{agent.name}</p>
                    <p className="text-[10px] text-zinc-500 text-center leading-tight">{agent.role}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// ── Add Goal Form ─────────────────────────────────────────────────────────────

interface AddGoalFormProps {
  onAdd: (goal: Goal) => void
  onCancel: () => void
  agents: AgentInfo[]
}

function AddGoalForm({ onAdd, onCancel, agents }: AddGoalFormProps) {
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [priority, setPriority] = useState<Goal["priority"]>("medium")
  const [assignedTo, setAssignedTo] = useState("")
  const [loading, setLoading] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) return
    setLoading(true)
    try {
      const res = await fetch("/api/company/goals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim(), description: description.trim() || undefined, priority, assignedTo: assignedTo || undefined }),
      })
      if (res.ok) {
        const goal = await res.json() as Goal
        onAdd(goal)
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <form
      onSubmit={submit}
      className="rounded-xl p-4 space-y-3"
      style={{ backgroundColor: "#0d0d18", border: "1px solid rgba(124,58,237,0.3)" }}
    >
      <p className="text-xs font-semibold" style={{ color: "#a78bfa" }}>New Goal</p>
      <input
        className="w-full rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 outline-none focus:ring-1"
        style={{ backgroundColor: "#111118", border: "1px solid #2a2a4e" }}
        placeholder="Goal title..."
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        autoFocus
      />
      <input
        className="w-full rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 outline-none"
        style={{ backgroundColor: "#111118", border: "1px solid #2a2a4e" }}
        placeholder="Description (optional)"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />
      <div className="flex gap-2">
        <select
          className="flex-1 rounded-lg px-3 py-2 text-sm text-white outline-none"
          style={{ backgroundColor: "#111118", border: "1px solid #2a2a4e" }}
          value={priority}
          onChange={(e) => setPriority(e.target.value as Goal["priority"])}
        >
          <option value="high">High Priority</option>
          <option value="medium">Medium Priority</option>
          <option value="low">Low Priority</option>
        </select>
        <select
          className="flex-1 rounded-lg px-3 py-2 text-sm text-white outline-none"
          style={{ backgroundColor: "#111118", border: "1px solid #2a2a4e" }}
          value={assignedTo}
          onChange={(e) => setAssignedTo(e.target.value)}
        >
          <option value="">No agent</option>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>{a.emoji} {a.name}</option>
          ))}
        </select>
      </div>
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={loading || !title.trim()}
          className="px-4 py-2 rounded-lg text-xs font-semibold transition-opacity disabled:opacity-50"
          style={{ backgroundColor: "#7c3aed", color: "white" }}
        >
          {loading ? "Adding..." : "Add Goal"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 rounded-lg text-xs font-medium text-zinc-400 hover:text-white transition-colors"
          style={{ backgroundColor: "#1a1a2e" }}
        >
          Cancel
        </button>
      </div>
    </form>
  )
}

// ── Goal Card ─────────────────────────────────────────────────────────────────

interface GoalCardProps {
  goal: Goal
  tasks: TaskSummary[]
  onCycleStatus: (goal: Goal) => void
}

function GoalCard({ goal, tasks, onCycleStatus }: GoalCardProps) {
  const statusStyle = STATUS_STYLE[goal.status]
  const priorityColor = PRIORITY_COLOR[goal.priority]
  const agentEmoji = goal.assignedTo ? (AGENT_EMOJI[goal.assignedTo] ?? "") : ""
  const linkedTasks = tasks.filter((t) => goal.taskIds.includes(t.id))
  const { total, done, percent } = goal.progress

  return (
    <div
      className="rounded-xl p-4 space-y-3 transition-all hover:bg-white/[0.02]"
      style={{ backgroundColor: "#111118", border: "1px solid #1a1a2e" }}
    >
      {/* Header row */}
      <div className="flex items-start gap-3">
        {/* Priority dot */}
        <div
          className="w-2 h-2 rounded-full shrink-0 mt-1.5"
          style={{ backgroundColor: priorityColor }}
          title={`${goal.priority} priority`}
        />

        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm font-semibold text-white leading-snug">{goal.title}</p>
            <div className="flex items-center gap-2 shrink-0">
              {agentEmoji && (
                <span className="text-base" title={goal.assignedTo}>{agentEmoji}</span>
              )}
              <button
                onClick={() => onCycleStatus(goal)}
                className="text-[10px] font-semibold px-2 py-0.5 rounded-full cursor-pointer transition-opacity hover:opacity-70"
                style={{ backgroundColor: statusStyle.bg, color: statusStyle.color }}
                title="Click to cycle status"
              >
                {statusStyle.label}
              </button>
            </div>
          </div>
          {goal.description && (
            <p className="text-[11px] text-zinc-500 leading-snug">{goal.description}</p>
          )}
          <div className="flex items-center gap-3 pt-0.5">
            <span className="text-[10px] font-medium" style={{ color: priorityColor }}>
              {goal.priority}
            </span>
            {goal.assignedTo && (
              <span className="text-[10px] text-zinc-600">{goal.assignedTo}</span>
            )}
          </div>
        </div>
      </div>

      {/* Progress bar */}
      {total > 0 && (
        <div className="space-y-1.5 pl-5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-zinc-600">Progress</span>
            <span className="text-[10px] font-medium text-zinc-400">{done}/{total} tasks done</span>
          </div>
          <div
            className="w-full h-1.5 rounded-full overflow-hidden"
            style={{ backgroundColor: "#1a1a2e" }}
          >
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${percent}%`,
                backgroundColor: percent === 100 ? "#22c55e" : "#7c3aed",
              }}
            />
          </div>
        </div>
      )}

      {/* Linked tasks */}
      <div className="pl-5 space-y-1">
        {linkedTasks.length === 0 ? (
          <p className="text-[11px] text-zinc-700 italic">No tasks linked yet</p>
        ) : (
          linkedTasks.slice(0, 5).map((task) => (
            <div key={task.id} className="flex items-center gap-2">
              <div
                className="w-1.5 h-1.5 rounded-full shrink-0"
                style={{ backgroundColor: COLUMN_DOT[task.column] ?? "#71717a" }}
                title={task.column}
              />
              <Link
                href="/tasks"
                className="text-[11px] text-zinc-400 hover:text-zinc-200 transition-colors truncate max-w-[280px]"
              >
                {task.title}
              </Link>
            </div>
          ))
        )}
        {linkedTasks.length > 5 && (
          <p className="text-[10px] text-zinc-600">+{linkedTasks.length - 5} more</p>
        )}
      </div>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

interface SetupData {
  userName?: string
  assistantName?: string
  companyName?: string
  companyTagline?: string
  companyMission?: string
}

interface AgentInfo {
  id: string
  name: string
  emoji: string
  role: string
  accent: string
  isChief?: boolean
}

export default function CompanyPage() {
  const [budgets, setBudgets] = useState<AgentBudget[]>([])
  const [goals, setGoals] = useState<Goal[]>([])
  const [allTasks, setAllTasks] = useState<TaskSummary[]>([])
  const [loadingBudgets, setLoadingBudgets] = useState(true)
  const [loadingGoals, setLoadingGoals] = useState(true)
  const [showAddGoal, setShowAddGoal] = useState(false)
  const [setup, setSetup] = useState<SetupData>({})
  const [agents, setAgents] = useState<AgentInfo[]>([])

  const fetchBudgets = useCallback(async () => {
    try {
      const res = await fetch("/api/company/budgets", { cache: "no-store" })
      const data = await res.json() as { agents: AgentBudget[] }
      setBudgets(data.agents ?? [])
    } catch {
      // leave empty
    } finally {
      setLoadingBudgets(false)
    }
  }, [])

  const fetchGoals = useCallback(async () => {
    try {
      const res = await fetch("/api/company/goals", { cache: "no-store" })
      const data = await res.json() as Goal[]
      setGoals(Array.isArray(data) ? data : [])
    } catch {
      // leave empty
    } finally {
      setLoadingGoals(false)
    }
  }, [])

  const fetchTasks = useCallback(async () => {
    try {
      const res = await fetch("/api/tasks", { cache: "no-store" })
      const data = await res.json() as TaskSummary[]
      setAllTasks(Array.isArray(data) ? data : [])
    } catch {
      // leave empty
    }
  }, [])

  const fetchSetup = useCallback(async () => {
    try {
      const res = await fetch("/api/setup/status", { cache: "no-store" })
      const data = await res.json() as SetupData
      setSetup(data)
    } catch { /* leave defaults */ }
  }, [])

  const fetchAgents = useCallback(async () => {
    try {
      const res = await fetch("/api/agents", { cache: "no-store" })
      const data = await res.json() as AgentInfo[]
      if (Array.isArray(data)) setAgents(data)
    } catch { /* leave empty */ }
  }, [])

  useEffect(() => {
    fetchBudgets()
    fetchGoals()
    fetchTasks()
    fetchSetup()
    fetchAgents()
  }, [fetchBudgets, fetchGoals, fetchTasks, fetchSetup, fetchAgents])

  async function cycleGoalStatus(goal: Goal) {
    const nextStatus = STATUS_CYCLE[goal.status]
    setGoals((prev) => prev.map((g) => g.id === goal.id ? { ...g, status: nextStatus } : g))
    try {
      await fetch(`/api/company/goals/${goal.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      })
    } catch {
      setGoals((prev) => prev.map((g) => g.id === goal.id ? goal : g))
    }
  }

  function handleGoalAdded(goal: Goal) {
    setGoals((prev) => [...prev, goal])
    setShowAddGoal(false)
  }

  return (
    <div className="max-w-4xl mx-auto space-y-8 pb-16">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-white">Company</h1>
        <p className="text-sm text-zinc-500 mt-1">{setup.companyName || "My Company"}{setup.companyTagline ? ` · ${setup.companyTagline}` : ""}</p>
      </div>

      {/* ── Section 1: Mission Statement ─────────────────────────── */}
      <section className="space-y-3">
        <p className="text-xs font-mono uppercase tracking-widest text-zinc-600">Mission</p>
        <div
          className="rounded-2xl p-6 space-y-4"
          style={{
            backgroundColor: "#111118",
            border: "1px solid rgba(124,58,237,0.3)",
            boxShadow: "0 0 40px rgba(124,58,237,0.06)",
          }}
        >
          <div className="flex items-center gap-2">
            <div
              className="w-1 h-8 rounded-full"
              style={{ backgroundColor: "#7c3aed" }}
            />
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: "#7c3aed" }}>
                {setup.companyName || "My Company"}{setup.companyTagline ? ` · ${setup.companyTagline}` : ""}
              </p>
            </div>
          </div>
          <blockquote className="text-lg font-medium text-white leading-relaxed pl-3">
            &ldquo;{setup.companyMission || "Build and run an autonomous agent team that executes, learns, and scales — so you can focus on strategy."}&rdquo;
          </blockquote>
        </div>
      </section>

      {/* ── Section 2: Org Chart ──────────────────────────────────── */}
      <section className="space-y-3">
        <p className="text-xs font-mono uppercase tracking-widest text-zinc-600">Org Chart</p>
        <div
          className="rounded-2xl p-8"
          style={{ backgroundColor: "#111118", border: "1px solid #1a1a2e" }}
        >
          <OrgChart
            userName={setup.userName || ""}
            chiefAgent={agents.find((a) => a.isChief || a.id === "chief" || a.role?.toLowerCase().includes("chief")) ?? agents[0] ?? null}
            otherAgents={agents.filter((a) => {
              const chief = agents.find((ag) => ag.isChief || ag.id === "chief" || ag.role?.toLowerCase().includes("chief")) ?? agents[0]
              return chief ? a.id !== chief.id : true
            })}
          />
        </div>
      </section>

      {/* ── Section 3: Agent Budgets ─────────────────────────────── */}
      <section className="space-y-3">
        <p className="text-xs font-mono uppercase tracking-widest text-zinc-600">Agent Budgets · This Month</p>
        <div
          className="rounded-2xl overflow-hidden"
          style={{ backgroundColor: "#111118", border: "1px solid #1a1a2e" }}
        >
          {loadingBudgets ? (
            <div className="p-8 text-center text-xs text-zinc-600">Loading...</div>
          ) : (
            <div className="divide-y divide-zinc-800/40">
              {budgets.map((agent) => {
                const pct = agent.budgetUsd > 0
                  ? Math.min(100, Math.round((agent.spentUsd / agent.budgetUsd) * 100))
                  : 0
                const barColor = budgetColor(pct)
                return (
                  <div key={agent.name} className="px-6 py-4 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-lg">{agent.emoji}</span>
                        <span className="text-sm font-semibold text-white">{agent.name}</span>
                      </div>
                      <div className="text-right">
                        <span className="text-sm font-mono font-bold" style={{ color: barColor }}>
                          ${agent.spentUsd.toFixed(2)}
                        </span>
                        <span className="text-xs text-zinc-600 ml-1">/ ${agent.budgetUsd}</span>
                        <span
                          className="ml-2 text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
                          style={{ backgroundColor: `${barColor}20`, color: barColor }}
                        >
                          {pct}%
                        </span>
                      </div>
                    </div>
                    <div
                      className="w-full h-1.5 rounded-full overflow-hidden"
                      style={{ backgroundColor: "#1a1a2e" }}
                    >
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{ width: `${pct}%`, backgroundColor: barColor }}
                      />
                    </div>
                    <div className="flex justify-between items-center">
                      <p className="text-[10px] text-zinc-600">
                        {agent.tokens.toLocaleString()} tokens
                      </p>
                      <p className="text-[10px] text-zinc-600">of ${agent.budgetUsd}/mo budget</p>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </section>

      {/* ── Section 4: Goals ─────────────────────────────────────── */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-mono uppercase tracking-widest text-zinc-600">Goals</p>
          <button
            onClick={() => setShowAddGoal(true)}
            className="text-xs font-semibold px-3 py-1.5 rounded-lg transition-all hover:opacity-80"
            style={{
              backgroundColor: "rgba(124,58,237,0.15)",
              border: "1px solid rgba(124,58,237,0.3)",
              color: "#a78bfa",
            }}
          >
            + Add Goal
          </button>
        </div>

        {showAddGoal && (
          <AddGoalForm
            onAdd={handleGoalAdded}
            onCancel={() => setShowAddGoal(false)}
            agents={agents}
          />
        )}

        {loadingGoals ? (
          <div
            className="rounded-2xl p-8 text-center text-xs text-zinc-600"
            style={{ backgroundColor: "#111118", border: "1px solid #1a1a2e" }}
          >
            Loading...
          </div>
        ) : goals.length === 0 ? (
          <div
            className="rounded-2xl p-8 text-center text-xs text-zinc-600"
            style={{ backgroundColor: "#111118", border: "1px solid #1a1a2e" }}
          >
            No goals yet. Add one above.
          </div>
        ) : (
          <div className="space-y-2">
            {goals.map((goal) => (
              <GoalCard
                key={goal.id}
                goal={goal}
                tasks={allTasks}
                onCycleStatus={cycleGoalStatus}
              />
            ))}
          </div>
        )}
      </section>

      {/* Back link */}
      <div className="pt-2">
        <Link href="/dashboard" className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors">
          ← Dashboard
        </Link>
      </div>
    </div>
  )
}
