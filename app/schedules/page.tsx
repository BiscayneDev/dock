"use client"

import { useEffect, useState, useCallback } from "react"
import Link from "next/link"

// ── Types ─────────────────────────────────────────────────────────────────────

interface AgentSchedule {
  id: string
  name: string
  agent: string
  prompt: string
  frequency: string
  hour: number
  dayOfWeek?: number
  timezone: string
  enabled: boolean
  lastRunAt: string | null
  nextRunAt: string | null
  lastStatus: "success" | "error" | null
  lastError: string | null
}

interface AgentInfo {
  id: string
  name: string
  emoji: string
  accent: string
}

// ── Constants ─────────────────────────────────────────────────────────────────

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

const FALLBACK_AGENTS: Record<string, { name: string; emoji: string; accent: string }> = {
  scout: { name: "Scout", emoji: "🔭", accent: "#06b6d4" },
  builder: { name: "Builder", emoji: "⚡", accent: "#10b981" },
  "deal-flow": { name: "Deal Flow", emoji: "🤝", accent: "#f59e0b" },
  baron: { name: "Baron", emoji: "🏦", accent: "#ec4899" },
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function relativeTime(iso: string | null): string {
  if (!iso) return "never"
  const diff = Date.now() - new Date(iso).getTime()
  if (diff < 0) {
    // Future
    const absDiff = Math.abs(diff)
    const mins = Math.floor(absDiff / 60000)
    const hrs = Math.floor(absDiff / 3600000)
    if (mins < 60) return `in ${mins}m`
    if (hrs < 24) return `in ${hrs}h`
    return `in ${Math.floor(absDiff / 86400000)}d`
  }
  const mins = Math.floor(diff / 60000)
  const hrs = Math.floor(diff / 3600000)
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins}m ago`
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(diff / 86400000)}d ago`
}

function frequencyLabel(s: AgentSchedule): string {
  switch (s.frequency) {
    case "hourly": return "Every hour"
    case "daily": return `Daily at ${s.hour}:00`
    case "weekly": return `${DAY_LABELS[s.dayOfWeek ?? 1]} at ${s.hour}:00`
    default: return s.frequency
  }
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function SchedulesPage() {
  const [schedules, setSchedules] = useState<AgentSchedule[]>([])
  const [agents, setAgents] = useState<AgentInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [formName, setFormName] = useState("")
  const [formAgent, setFormAgent] = useState("")
  const [formPrompt, setFormPrompt] = useState("")
  const [formFrequency, setFormFrequency] = useState("daily")
  const [formHour, setFormHour] = useState(9)
  const [formDay, setFormDay] = useState(1)
  const [saving, setSaving] = useState(false)

  const fetchSchedules = useCallback(async () => {
    try {
      const res = await fetch("/api/schedules")
      const data = await res.json()
      if (Array.isArray(data)) setSchedules(data)
    } catch { /* leave empty */ }
    finally { setLoading(false) }
  }, [])

  const fetchAgents = useCallback(async () => {
    try {
      const res = await fetch("/api/agents")
      const data = await res.json()
      if (Array.isArray(data)) {
        setAgents(data)
        if (!formAgent && data.length > 0) setFormAgent(data[0].id)
      }
    } catch { /* use fallbacks */ }
  }, [formAgent])

  useEffect(() => {
    fetchSchedules()
    fetchAgents()

    // Tick every 5 minutes to check for due schedules
    const tickInterval = setInterval(() => {
      fetch("/api/schedules/tick", { method: "POST" })
        .then(() => fetchSchedules())
        .catch(() => null)
    }, 5 * 60 * 1000)

    // Initial tick
    fetch("/api/schedules/tick", { method: "POST" }).catch(() => null)

    return () => clearInterval(tickInterval)
  }, [fetchSchedules, fetchAgents])

  function getAgent(id: string) {
    return agents.find((a) => a.id === id) ?? FALLBACK_AGENTS[id] ?? { name: id, emoji: "🤖", accent: "#71717a" }
  }

  async function createSchedule() {
    if (!formName.trim() || !formAgent || !formPrompt.trim()) return
    setSaving(true)
    try {
      const res = await fetch("/api/schedules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: formName.trim(),
          agent: formAgent,
          prompt: formPrompt.trim(),
          frequency: formFrequency,
          hour: formHour,
          dayOfWeek: formFrequency === "weekly" ? formDay : undefined,
        }),
      })
      if (res.ok) {
        setAdding(false)
        setFormName("")
        setFormPrompt("")
        fetchSchedules()
      }
    } finally { setSaving(false) }
  }

  async function toggleSchedule(id: string, enabled: boolean) {
    setSchedules((prev) => prev.map((s) => s.id === id ? { ...s, enabled } : s))
    await fetch(`/api/schedules/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    }).catch(() => fetchSchedules())
  }

  async function deleteSchedule(id: string) {
    setSchedules((prev) => prev.filter((s) => s.id !== id))
    await fetch(`/api/schedules/${id}`, { method: "DELETE" }).catch(() => fetchSchedules())
  }

  async function runNow(schedule: AgentSchedule) {
    // Force nextRunAt to now and tick
    await fetch(`/api/schedules/${schedule.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nextRunAt: new Date().toISOString() }),
    })
    await fetch("/api/schedules/tick", { method: "POST" })
    fetchSchedules()
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-16">
      {/* Header */}
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white">Schedules</h1>
          <p className="text-sm text-zinc-500 mt-1">Autonomous agent runs on autopilot</p>
        </div>
        <button
          onClick={() => setAdding(true)}
          className="px-4 py-2 rounded-lg text-xs font-semibold transition-all hover:opacity-80"
          style={{
            backgroundColor: "rgba(16,185,129,0.15)",
            border: "1px solid rgba(16,185,129,0.3)",
            color: "#10b981",
          }}
        >
          + New Schedule
        </button>
      </div>

      {/* Add Schedule Form */}
      {adding && (
        <div
          className="rounded-xl p-5 space-y-4"
          style={{ backgroundColor: "#111118", border: "1px solid rgba(16,185,129,0.3)" }}
        >
          <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "#10b981" }}>
            New Scheduled Task
          </p>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-[10px] text-zinc-500 uppercase tracking-wider">Name</label>
              <input
                className="w-full rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 outline-none"
                style={{ backgroundColor: "#0a0a0f", border: "1px solid #1a1a2e" }}
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder='e.g. "Daily market scan"'
                autoFocus
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] text-zinc-500 uppercase tracking-wider">Agent</label>
              <select
                className="w-full rounded-lg px-3 py-2 text-sm text-white outline-none"
                style={{ backgroundColor: "#0a0a0f", border: "1px solid #1a1a2e" }}
                value={formAgent}
                onChange={(e) => setFormAgent(e.target.value)}
              >
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>{a.emoji} {a.name}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-[10px] text-zinc-500 uppercase tracking-wider">Prompt</label>
            <textarea
              className="w-full rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 outline-none resize-none"
              style={{ backgroundColor: "#0a0a0f", border: "1px solid #1a1a2e" }}
              rows={3}
              value={formPrompt}
              onChange={(e) => setFormPrompt(e.target.value)}
              placeholder="What should this agent do on each run?"
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <label className="text-[10px] text-zinc-500 uppercase tracking-wider">Frequency</label>
              <select
                className="w-full rounded-lg px-3 py-2 text-sm text-white outline-none"
                style={{ backgroundColor: "#0a0a0f", border: "1px solid #1a1a2e" }}
                value={formFrequency}
                onChange={(e) => setFormFrequency(e.target.value)}
              >
                <option value="hourly">Every hour</option>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
              </select>
            </div>
            {formFrequency !== "hourly" && (
              <div className="space-y-1">
                <label className="text-[10px] text-zinc-500 uppercase tracking-wider">Hour</label>
                <select
                  className="w-full rounded-lg px-3 py-2 text-sm text-white outline-none"
                  style={{ backgroundColor: "#0a0a0f", border: "1px solid #1a1a2e" }}
                  value={formHour}
                  onChange={(e) => setFormHour(parseInt(e.target.value))}
                >
                  {Array.from({ length: 24 }).map((_, h) => (
                    <option key={h} value={h}>{h}:00</option>
                  ))}
                </select>
              </div>
            )}
            {formFrequency === "weekly" && (
              <div className="space-y-1">
                <label className="text-[10px] text-zinc-500 uppercase tracking-wider">Day</label>
                <select
                  className="w-full rounded-lg px-3 py-2 text-sm text-white outline-none"
                  style={{ backgroundColor: "#0a0a0f", border: "1px solid #1a1a2e" }}
                  value={formDay}
                  onChange={(e) => setFormDay(parseInt(e.target.value))}
                >
                  {DAY_LABELS.map((d, i) => (
                    <option key={i} value={i}>{d}</option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <div className="flex gap-2">
            <button
              onClick={createSchedule}
              disabled={saving || !formName.trim() || !formPrompt.trim()}
              className="px-4 py-2 rounded-lg text-xs font-semibold transition-opacity disabled:opacity-50"
              style={{ backgroundColor: "#10b981", color: "#0a0a0f" }}
            >
              {saving ? "Creating..." : "Create Schedule"}
            </button>
            <button
              onClick={() => setAdding(false)}
              className="px-4 py-2 rounded-lg text-xs font-medium text-zinc-400 hover:text-white transition-colors"
              style={{ backgroundColor: "#1a1a2e" }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Schedule List */}
      {loading ? (
        <div
          className="rounded-2xl p-8 text-center text-xs text-zinc-600"
          style={{ backgroundColor: "#111118", border: "1px solid #1a1a2e" }}
        >
          Loading schedules...
        </div>
      ) : schedules.length === 0 ? (
        <div
          className="rounded-2xl p-12 text-center space-y-3"
          style={{ backgroundColor: "#111118", border: "1px solid #1a1a2e" }}
        >
          <p className="text-3xl">🕐</p>
          <p className="text-sm text-zinc-400">No scheduled tasks yet</p>
          <p className="text-xs text-zinc-600 max-w-sm mx-auto">
            Create schedules to have your agents automatically run research, reports, monitoring, and more on autopilot.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {schedules.map((schedule) => {
            const agent = getAgent(schedule.agent)
            return (
              <div
                key={schedule.id}
                className="group rounded-xl p-4 space-y-2 transition-all hover:bg-white/[0.02]"
                style={{
                  backgroundColor: "#111118",
                  border: `1px solid ${schedule.enabled ? "#1a1a2e" : "#1a1a2e80"}`,
                  opacity: schedule.enabled ? 1 : 0.6,
                }}
              >
                {/* Header row */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="text-lg">{agent.emoji}</span>
                    <div>
                      <p className="text-sm font-semibold text-white">{schedule.name}</p>
                      <p className="text-[11px] text-zinc-500">
                        {frequencyLabel(schedule)} · <span style={{ color: agent.accent }}>{agent.name}</span>
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {schedule.lastStatus === "error" && (
                      <span
                        className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                        style={{ backgroundColor: "rgba(239,68,68,0.15)", color: "#ef4444" }}
                        title={schedule.lastError ?? "Error"}
                      >
                        Error
                      </span>
                    )}
                    {schedule.lastStatus === "success" && (
                      <span
                        className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                        style={{ backgroundColor: "rgba(34,197,94,0.12)", color: "#22c55e" }}
                      >
                        OK
                      </span>
                    )}

                    {/* Toggle */}
                    <button
                      onClick={() => toggleSchedule(schedule.id, !schedule.enabled)}
                      className="relative w-10 h-5 rounded-full transition-colors"
                      style={{ backgroundColor: schedule.enabled ? "#10b981" : "#27272a" }}
                    >
                      <div
                        className="absolute w-4 h-4 rounded-full bg-white top-0.5 transition-all"
                        style={{ left: schedule.enabled ? 22 : 2 }}
                      />
                    </button>

                    {/* Run now */}
                    <button
                      onClick={() => runNow(schedule)}
                      className="opacity-0 group-hover:opacity-100 text-[10px] text-zinc-500 hover:text-emerald-400 transition-all px-2 py-1 rounded"
                      style={{ backgroundColor: "#1a1a2e" }}
                    >
                      Run Now
                    </button>

                    {/* Delete */}
                    <button
                      onClick={() => deleteSchedule(schedule.id)}
                      className="opacity-0 group-hover:opacity-100 text-zinc-700 hover:text-red-400 transition-all text-xs px-1"
                    >
                      ✕
                    </button>
                  </div>
                </div>

                {/* Prompt preview */}
                <p className="text-xs text-zinc-500 leading-relaxed pl-8 line-clamp-2">
                  {schedule.prompt}
                </p>

                {/* Timing info */}
                <div className="flex items-center gap-4 pl-8 text-[10px] text-zinc-600">
                  <span>Last run: {relativeTime(schedule.lastRunAt)}</span>
                  <span>Next run: {relativeTime(schedule.nextRunAt)}</span>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Back link */}
      <div className="pt-2">
        <Link href="/dashboard" className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors">
          ← Dashboard
        </Link>
      </div>
    </div>
  )
}
