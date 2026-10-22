"use client"

import { useEffect, useState, useCallback } from "react"
import type { AgentData } from "@/app/api/agents/route"

// Session key → agent display info
const SESSION_AGENT_MAP: Record<string, { emoji: string; name: string }> = {
  subagent: { emoji: "⚡", name: "Builder" },
  builder: { emoji: "⚡", name: "Builder" },
  scout: { emoji: "🔭", name: "Scout" },
  dealflow: { emoji: "🤝", name: "Deal Flow" },
  "deal-flow": { emoji: "🤝", name: "Deal Flow" },
  wallet: { emoji: "🏦", name: "Baron" },
}

function resolveSession(key: string): { emoji: string; name: string } {
  const lower = key.toLowerCase()
  for (const [pattern, info] of Object.entries(SESSION_AGENT_MAP)) {
    if (lower.includes(pattern)) return info
  }
  return { emoji: "🤖", name: key }
}

interface Session {
  key?: string
  id?: string
  label?: string
  model?: string
  status?: string
  startedAt?: string
  created_at?: string
  [key: string]: unknown
}

interface ActivityEvent {
  id: string
  timestamp: string
  agentEmoji: string
  agentName: string
  action: string
  detail: string
}

interface ActivityResponse {
  events: ActivityEvent[]
  lastUpdated: string | null
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 2) return "just now"
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

function truncateModel(model: string): string {
  return model.replace(/^(anthropic|openai|google)\//, "").slice(0, 30)
}

function getFormattedDate(): string {
  return new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  })
}

// ── Agent Modal ───────────────────────────────────────────────────────────────

interface AgentModalProps {
  agent: AgentData | null  // null = create mode
  onClose: () => void
  onSave: (data: Partial<AgentData>) => Promise<void>
}

function AgentModal({ agent, onClose, onSave }: AgentModalProps) {
  const isCreate = agent === null
  const [name, setName] = useState(agent?.name ?? "")
  const [emoji, setEmoji] = useState(agent?.emoji ?? "🤖")
  const [role, setRole] = useState(agent?.role ?? "")
  const [description, setDescription] = useState(agent?.description ?? "")
  const [accent, setAccent] = useState(agent?.accent ?? "#6366f1")
  const [tagsInput, setTagsInput] = useState(agent?.tags?.join(", ") ?? "")
  const [saving, setSaving] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      const tags = tagsInput
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean)
      await onSave({ name, emoji, role, description, accent, tags })
      onClose()
    } finally {
      setSaving(false)
    }
  }

  const inputStyle = {
    backgroundColor: "var(--surface-2)",
    border: "1px solid var(--line)",
    color: "var(--ink)",
    outline: "none",
  } as const

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)" }}
    >
      <div
        className="w-full max-w-md space-y-5 rounded-[17px] p-7"
        style={{
          backgroundColor: "var(--surface-1)",
          border: "1px solid var(--line)",
        }}
      >
        <div className="flex items-baseline justify-between">
          <h2 className="font-mono text-[9.5px] uppercase tracking-[0.16em]" style={{ color: "var(--ink-3)" }}>
            {isCreate ? "New agent" : `Edit · ${agent.name}`}
          </h2>
          <button
            onClick={onClose}
            className="text-[15px] leading-none transition-colors"
            style={{ color: "var(--ink-3)" }}
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="flex gap-3">
            <div className="w-20">
              <label className="mb-1.5 block font-mono text-[9.5px] uppercase tracking-[0.16em]" style={{ color: "var(--ink-3)" }}>
                Emoji
              </label>
              <input
                value={emoji}
                onChange={(e) => setEmoji(e.target.value)}
                className="w-full rounded-[10px] px-3 py-2 text-center text-xl"
                style={inputStyle}
                maxLength={4}
                required
              />
            </div>
            <div className="flex-1">
              <label className="mb-1.5 block font-mono text-[9.5px] uppercase tracking-[0.16em]" style={{ color: "var(--ink-3)" }}>
                Name
              </label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-[10px] px-3 py-2 text-[13px]"
                style={inputStyle}
                placeholder="Agent name"
                required
              />
            </div>
          </div>

          <div>
            <label className="mb-1.5 block font-mono text-[9.5px] uppercase tracking-[0.16em]" style={{ color: "var(--ink-3)" }}>
              Role
            </label>
            <input
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="w-full rounded-[10px] px-3 py-2 text-[13px]"
              style={inputStyle}
              placeholder="e.g. Market Intelligence"
            />
          </div>

          <div>
            <label className="mb-1.5 block font-mono text-[9.5px] uppercase tracking-[0.16em]" style={{ color: "var(--ink-3)" }}>
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full resize-none rounded-[10px] px-3 py-2 text-[13px]"
              style={inputStyle}
              rows={3}
              placeholder="What does this agent do?"
            />
          </div>

          <div>
            <label className="mb-1.5 block font-mono text-[9.5px] uppercase tracking-[0.16em]" style={{ color: "var(--ink-3)" }}>
              Identity dot
            </label>
            <div className="flex items-center gap-2.5">
              <span
                className="h-[18px] w-[18px] shrink-0 rounded-full"
                style={{ backgroundColor: accent, boxShadow: `0 0 8px ${accent}66` }}
              />
              <input
                value={accent}
                onChange={(e) => setAccent(e.target.value)}
                className="flex-1 rounded-[10px] px-3 py-2 font-mono text-[12px]"
                style={inputStyle}
                placeholder="#7c3aed"
              />
              <input
                type="color"
                value={accent}
                onChange={(e) => setAccent(e.target.value)}
                className="h-[34px] w-[34px] shrink-0 cursor-pointer rounded-[10px] border"
                style={{ borderColor: "var(--line)", backgroundColor: "transparent", padding: "1px" }}
              />
            </div>
          </div>

          <div>
            <label className="mb-1.5 block font-mono text-[9.5px] uppercase tracking-[0.16em]" style={{ color: "var(--ink-3)" }}>
              Tags
            </label>
            <input
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              className="w-full rounded-[10px] px-3 py-2 text-[13px]"
              style={inputStyle}
              placeholder="DeFi, Solana, Yield"
            />
          </div>

          <div className="flex gap-2.5 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-[10px] border py-2 font-mono text-[10.5px] uppercase tracking-[0.08em] transition-colors"
              style={{ borderColor: "var(--line)", backgroundColor: "var(--surface-2)", color: "var(--ink-2)" }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 rounded-[10px] py-2 font-mono text-[10.5px] uppercase tracking-[0.08em] transition-all duration-200 hover:-translate-y-[1px]"
              style={{
                backgroundColor: saving ? "rgba(231,201,121,.4)" : "var(--gold)",
                color: "#1a1508",
              }}
            >
              {saving ? "Saving…" : isCreate ? "Create" : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Delete confirm dialog ─────────────────────────────────────────────────────

interface DeleteDialogProps {
  agent: AgentData
  onClose: () => void
  onConfirm: () => Promise<void>
}

function DeleteDialog({ agent, onClose, onConfirm }: DeleteDialogProps) {
  const [deleting, setDeleting] = useState(false)

  async function handleConfirm() {
    setDeleting(true)
    try {
      await onConfirm()
      onClose()
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)" }}
    >
      <div
        className="w-full max-w-sm space-y-5 rounded-[17px] p-7"
        style={{
          backgroundColor: "var(--surface-1)",
          border: "1px solid var(--line)",
        }}
      >
        <div className="space-y-2.5 text-center">
          <div className="text-[26px]">{agent.emoji}</div>
          <h2 className="text-[15px] font-semibold" style={{ color: "var(--ink)" }}>
            Delete {agent.name}?
          </h2>
          <p className="text-[12px]" style={{ color: "var(--ink-3)" }}>
            This cannot be undone. The agent will be removed permanently.
          </p>
        </div>
        <div className="flex gap-2.5">
          <button
            onClick={onClose}
            className="flex-1 rounded-[10px] border py-2 font-mono text-[10.5px] uppercase tracking-[0.08em] transition-colors"
            style={{ borderColor: "var(--line)", backgroundColor: "var(--surface-2)", color: "var(--ink-2)" }}
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={deleting}
            className="flex-1 rounded-[10px] py-2 font-mono text-[10.5px] uppercase tracking-[0.08em] transition-colors"
            style={{
              backgroundColor: deleting ? "rgba(239,68,68,.4)" : "rgba(239,68,68,.85)",
              color: "#fff",
            }}
          >
            {deleting ? "Deleting…" : "Delete"}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function AgentsPage() {
  const [agents, setAgents] = useState<AgentData[]>([])
  const [agentsLoading, setAgentsLoading] = useState(true)
  const [activity, setActivity] = useState<ActivityResponse | null>(null)
  const [activityLoading, setActivityLoading] = useState(true)
  const [sessions, setSessions] = useState<Session[]>([])
  const [sessionsLoading, setSessionsLoading] = useState(true)

  // Modal state: undefined = closed, null = create mode, AgentData = edit mode
  const [editAgent, setEditAgent] = useState<AgentData | null | undefined>(undefined)
  const [deleteAgent, setDeleteAgent] = useState<AgentData | null>(null)

  const fetchAgents = useCallback(async () => {
    try {
      const res = await fetch("/api/agents", { cache: "no-store" })
      const data: AgentData[] = await res.json()
      setAgents(data)
    } catch {
      // ignore
    } finally {
      setAgentsLoading(false)
    }
  }, [])

  const fetchActivity = useCallback(async () => {
    try {
      const res = await fetch("/api/activity", { cache: "no-store" })
      const data: ActivityResponse = await res.json()
      setActivity(data)
    } catch {
      // ignore
    } finally {
      setActivityLoading(false)
    }
  }, [])

  const fetchSessions = useCallback(async () => {
    try {
      const res = await fetch("/api/sessions", { cache: "no-store" })
      const data: { sessions: Session[] } = await res.json()
      setSessions(data.sessions ?? [])
    } catch {
      setSessions([])
    } finally {
      setSessionsLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchAgents()
    fetchActivity()
    fetchSessions()

    const activityInterval = setInterval(fetchActivity, 30_000)
    const sessionsInterval = setInterval(fetchSessions, 15_000)

    return () => {
      clearInterval(activityInterval)
      clearInterval(sessionsInterval)
    }
  }, [fetchAgents, fetchActivity, fetchSessions])

  async function handleSave(data: Partial<AgentData>) {
    if (editAgent === null) {
      // Create new agent
      const res = await fetch("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      })
      if (res.ok) {
        const created: AgentData = await res.json()
        setAgents((prev) => [...prev, created])
      }
    } else if (editAgent) {
      // Optimistic update
      setAgents((prev) =>
        prev.map((a) => (a.id === editAgent.id ? { ...a, ...data } : a))
      )
      await fetch(`/api/agents/${editAgent.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      })
      await fetchAgents()
    }
  }

  async function handleDelete(agent: AgentData) {
    // Optimistic remove
    setAgents((prev) => prev.filter((a) => a.id !== agent.id))
    await fetch(`/api/agents/${agent.id}`, { method: "DELETE" })
    await fetchAgents()
  }

  const chiefAgent = agents.find((a) => a.isChief)
  const otherAgents = agents.filter((a) => !a.isChief)
  const displayEvents = activity?.events?.slice(0, 8) ?? []

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
            style={{ backgroundColor: "var(--gold)", boxShadow: "0 0 7px var(--gold)" }}
          />
          {agentsLoading ? "syncing…" : `${agents.length} agents · ${sessions.length} live`}
        </span>
        <span className="font-mono text-[10.5px] uppercase tracking-[0.1em]" style={{ color: "var(--ink-3)" }}>
          {getFormattedDate()}
        </span>
      </div>

      {/* title */}
      <h1
        className="mt-10 font-serif text-[40px] font-normal leading-[1.1] tracking-[-0.01em]"
        style={{ color: "var(--ink)" }}
      >
        The <em style={{ color: "var(--ink-2)" }}>fleet</em>
      </h1>
      <p className="mt-2.5 max-w-[62ch] text-[14px] leading-[1.6]" style={{ color: "var(--ink-2)" }}>
        The chief of staff orchestrates; the specialists execute. Everything below runs itself —
        you are here for exceptions and direction.
      </p>

      {/* mission */}
      <p
        className="mt-6 border-l-2 pl-4 font-serif text-[14.5px] italic leading-[1.72]"
        style={{ borderColor: "var(--gold)", color: "var(--ink-2)" }}
      >
        Build an unfair advantage at the AI &times; crypto frontier — staying ahead of deals,
        protocols, and agent economies while automating everything that does not need me in it.
      </p>

      {/* Chief of staff hero */}
      {agentsLoading ? (
        <div
          className="mt-10 rounded-[15px] border p-5"
          style={{ borderColor: "var(--line)", backgroundColor: "var(--surface-1)" }}
        >
          <div className="h-6 w-1/3 animate-pulse rounded" style={{ backgroundColor: "var(--surface-3)" }} />
        </div>
      ) : chiefAgent ? (
        <section
          className="relative mt-10 overflow-hidden rounded-[17px] border p-6"
          style={{ borderColor: "var(--line)", background: "linear-gradient(180deg, var(--surface-1), #08080b)" }}
        >
          <div className="flex items-center gap-3.5">
            <span className="text-[22px]">{chiefAgent.emoji}</span>
            <span
              className="h-[7px] w-[7px] shrink-0 rounded-full"
              style={{ backgroundColor: chiefAgent.accent, boxShadow: `0 0 8px ${chiefAgent.accent}` }}
            />
            <span className="font-serif text-[20px]" style={{ color: "var(--ink)" }}>
              {chiefAgent.name}
            </span>
            <span className="font-mono text-[9.5px] uppercase tracking-[0.16em]" style={{ color: "var(--ink-3)" }}>
              orchestrator
            </span>
            {chiefAgent.tags.length > 0 && (
              <span className="ml-auto hidden font-mono text-[10px] tracking-[0.05em] sm:block" style={{ color: "var(--ink-3)" }}>
                {chiefAgent.tags.join(" · ")}
              </span>
            )}
            <button
              onClick={() => setEditAgent(chiefAgent)}
              title="Edit chief of staff"
              className="ml-auto shrink-0 text-[13px] transition-colors sm:ml-4"
              style={{ color: "var(--ink-3)" }}
            >
              ✎
            </button>
          </div>
          <p className="mt-3 max-w-[62ch] text-[13.5px] leading-[1.65]" style={{ color: "var(--ink-2)" }}>
            {chiefAgent.description}
          </p>
        </section>
      ) : null}

      {/* delegation line */}
      <p className="mt-5 flex items-center justify-center gap-2 font-mono text-[9.5px] uppercase tracking-[0.16em]" style={{ color: "var(--ink-3)" }}>
        <span>input</span>
        <span>→</span>
        <span style={{ color: "var(--gold)" }}>{chiefAgent?.name ?? "chief of staff"}</span>
        <span>→</span>
        <span>specialists</span>
      </p>

      {/* team header */}
      <div className="mb-4 mt-10 flex items-baseline justify-between">
        <h2 className="font-mono text-[9.5px] uppercase tracking-[0.16em]" style={{ color: "var(--ink-3)" }}>
          Team · {otherAgents.length}
        </h2>
        <button
          onClick={() => setEditAgent(null)}
          className="rounded-[10px] px-4 py-2 font-mono text-[10.5px] uppercase tracking-[0.08em] transition-all duration-200 hover:-translate-y-[1px]"
          style={{
            backgroundColor: "var(--gold)",
            color: "#1a1508",
          }}
        >
          + New agent
        </button>
      </div>

      {/* Agent grid */}
      {agentsLoading ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="rounded-[15px] border p-5"
              style={{ borderColor: "var(--line)", backgroundColor: "var(--surface-1)" }}
            >
              <div className="h-3.5 w-1/3 animate-pulse rounded" style={{ backgroundColor: "var(--surface-3)" }} />
              <div className="mt-3 h-3 w-2/3 animate-pulse rounded" style={{ backgroundColor: "var(--surface-3)" }} />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {otherAgents.map((agent) => (
            <div
              key={agent.id}
              className="group relative rounded-[15px] border p-5 transition-all duration-300 hover:-translate-y-[2px]"
              style={{ borderColor: "var(--line)", backgroundColor: "var(--surface-1)" }}
            >
              {/* Edit / Delete — appear on hover */}
              <div className="absolute right-3.5 top-3.5 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                <button
                  onClick={() => setEditAgent(agent)}
                  title="Edit agent"
                  className="text-[12px] transition-colors"
                  style={{ color: "var(--ink-3)" }}
                >
                  ✎
                </button>
                <button
                  onClick={() => setDeleteAgent(agent)}
                  title="Delete agent"
                  className="text-[12px] transition-colors"
                  style={{ color: "var(--ink-3)" }}
                >
                  ✕
                </button>
              </div>

              <div className="flex items-center gap-2.5">
                <span className="text-[17px]">{agent.emoji}</span>
                <span className="text-[13.5px] font-semibold tracking-[-0.003em]" style={{ color: "var(--ink)" }}>
                  {agent.name}
                </span>
                <span
                  className="h-[7px] w-[7px] shrink-0 rounded-full"
                  style={{ backgroundColor: agent.accent, boxShadow: `0 0 8px ${agent.accent}99` }}
                />
                {agent.role && (
                  <span className="font-mono text-[9.5px] uppercase tracking-[0.16em]" style={{ color: "var(--ink-3)" }}>
                    {agent.role}
                  </span>
                )}
              </div>
              <p className="mt-2.5 line-clamp-2 text-[12px] leading-[1.55]" style={{ color: "var(--ink-2)" }}>
                {agent.description}
              </p>
              {agent.tags.length > 0 && (
                <p className="mt-3 font-mono text-[10px] tracking-[0.05em]" style={{ color: "var(--ink-3)" }}>
                  {agent.tags.join(" · ")}
                </p>
              )}
            </div>
          ))}

          {otherAgents.length === 0 && (
            <div
              className="col-span-2 rounded-[15px] border p-8 text-center"
              style={{ borderColor: "var(--line)", backgroundColor: "var(--surface-1)" }}
            >
              <p className="text-[13px]" style={{ color: "var(--ink-3)" }}>
                No specialists yet — add one to start delegating.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Live Sessions */}
      <div className="mb-4 mt-10 flex items-baseline justify-between">
        <h2 className="font-mono text-[9.5px] uppercase tracking-[0.16em]" style={{ color: "var(--ink-3)" }}>
          Live sessions
        </h2>
        <span className="font-mono text-[10px]" style={{ color: "var(--ink-3)" }}>
          refreshes every 15s
        </span>
      </div>
      <div
        className="overflow-hidden rounded-[15px] border"
        style={{ borderColor: "var(--line)", backgroundColor: "var(--surface-1)" }}
      >
        {sessionsLoading ? (
          <p className="px-5 py-4 text-[12px]" style={{ color: "var(--ink-3)" }}>
            Connecting to gateway…
          </p>
        ) : sessions.length === 0 ? (
          <p className="px-5 py-4 text-[12px]" style={{ color: "var(--ink-3)" }}>
            All quiet — no active sessions right now.
          </p>
        ) : (
          <div>
            {sessions.map((session, idx) => {
              const key = session.key ?? session.id ?? session.label ?? String(idx)
              const { emoji, name } = resolveSession(key)
              const model = session.model ? truncateModel(String(session.model)) : null
              const startedAt = session.startedAt ?? session.created_at
              const status = session.status ?? "active"

              return (
                <div
                  key={key}
                  className="flex items-center gap-3 border-b px-5 py-3 transition-colors last:border-b-0 hover:bg-[var(--surface-2)]"
                  style={{ borderColor: "var(--line)" }}
                >
                  <span className="shrink-0 text-[15px]">{emoji}</span>
                  <div className="flex flex-1 flex-wrap items-baseline gap-2">
                    <span className="text-[12.5px] font-semibold" style={{ color: "var(--ink)" }}>
                      {name}
                    </span>
                    <span className="max-w-[160px] truncate font-mono text-[10px]" style={{ color: "var(--ink-3)" }}>
                      {key}
                    </span>
                    {model && (
                      <span className="max-w-[160px] truncate font-mono text-[10px]" style={{ color: "var(--ink-3)" }}>
                        · {model}
                      </span>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2.5">
                    <span
                      className="inline-flex items-center gap-1.5 font-mono text-[10px] capitalize"
                      style={{ color: "var(--gold)" }}
                    >
                      <span
                        className="h-[5px] w-[5px] rounded-full"
                        style={{ backgroundColor: "var(--gold)", boxShadow: "0 0 6px var(--gold)" }}
                      />
                      {status}
                    </span>
                    {startedAt && (
                      <span className="hidden font-mono text-[10px] tabular-nums sm:inline" style={{ color: "var(--ink-3)" }}>
                        {timeAgo(String(startedAt))}
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Activity */}
      <div className="mb-4 mt-10 flex items-baseline justify-between">
        <h2 className="font-mono text-[9.5px] uppercase tracking-[0.16em]" style={{ color: "var(--ink-3)" }}>
          Activity
        </h2>
        {activity?.lastUpdated && (
          <span className="font-mono text-[10px]" style={{ color: "var(--ink-3)" }}>
            updated {timeAgo(activity.lastUpdated)}
          </span>
        )}
      </div>
      <div
        className="overflow-hidden rounded-[15px] border"
        style={{ borderColor: "var(--line)", backgroundColor: "var(--surface-1)" }}
      >
        {activityLoading ? (
          <p className="px-5 py-4 text-[12px]" style={{ color: "var(--ink-3)" }}>
            Loading activity…
          </p>
        ) : displayEvents.length === 0 ? (
          <p className="px-5 py-4 text-[12px]" style={{ color: "var(--ink-3)" }}>
            No recent activity — events appear as agents run.
          </p>
        ) : (
          <div>
            {displayEvents.map((event) => (
              <div
                key={event.id}
                className="flex items-start gap-3 border-b px-5 py-3 transition-colors last:border-b-0 hover:bg-[var(--surface-2)]"
                style={{ borderColor: "var(--line)" }}
              >
                <span className="mt-0.5 shrink-0 text-[15px]">{event.agentEmoji}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-1.5">
                    <span className="text-[12.5px] font-semibold" style={{ color: "var(--ink)" }}>
                      {event.agentName}
                    </span>
                    <span className="text-[12px]" style={{ color: "var(--ink-2)" }}>
                      {event.action}
                    </span>
                    {event.detail && (
                      <span className="max-w-[200px] truncate text-[12px]" style={{ color: "var(--ink-3)" }}>
                        · {event.detail}
                      </span>
                    )}
                  </div>
                </div>
                <span className="shrink-0 font-mono text-[10px] tabular-nums" style={{ color: "var(--ink-3)" }}>
                  {timeAgo(event.timestamp)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Modals */}
      {editAgent !== undefined && (
        <AgentModal
          agent={editAgent}
          onClose={() => setEditAgent(undefined)}
          onSave={handleSave}
        />
      )}

      {deleteAgent && (
        <DeleteDialog
          agent={deleteAgent}
          onClose={() => setDeleteAgent(null)}
          onConfirm={() => handleDelete(deleteAgent)}
        />
      )}
    </div>
  )
}
