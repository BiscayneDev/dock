"use client"

import { useEffect, useState, useCallback } from "react"
import DevicesSection from "@/components/settings/DevicesSection"

// ── Types ──────────────────────────────────────────────────────────────────────

interface AgentData {
  id: string
  name: string
  emoji: string
  accent: string
  budget?: number
}

interface CostByModel {
  model: string
  estimatedCostUSD: number
}

interface CostsData {
  totalEstimatedCostUSD: number
  byModel: CostByModel[]
}

interface CronJob {
  id: string
  name: string
  schedule: string
  tz: string
  lastRunAt: string | null
  nextRunAt: string | null
  lastStatus: string | null
  lastError: string | null
  enabled: boolean
  consecutiveErrors: number
}

interface ServiceStatus {
  id: string
  name: string
  description: string
  connected: boolean
  error?: string
}

interface NotificationSettings {
  taskActivationAlerts: boolean
  agentCompletionToasts: boolean
  scoutSignalAlerts: boolean
  dealFlowDigest: boolean
  baronDailyReport: boolean
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function relativeTime(dateStr: string | null): string {
  if (!dateStr) return "Never"
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

const AGENT_SPEND_KEYS: Record<string, string[]> = {
  vic: ["main", "vic"],
  scout: ["scout"],
  "deal-flow": ["deal-flow", "dealflow"],
  builder: ["builder", "subagent"],
  baron: ["baron", "wallet"],
}

// ── Section: Agent Budgets ─────────────────────────────────────────────────────

function AgentBudgetsSection() {
  const [agents, setAgents] = useState<AgentData[]>([])
  const [costs, setCosts] = useState<CostsData | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState("")
  const [saving, setSaving] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([
      fetch("/api/agents").then((r) => r.json()),
      fetch("/api/costs").then((r) => r.json()),
    ]).then(([a, c]: [AgentData[], CostsData]) => {
      setAgents(a)
      setCosts(c)
    }).catch(() => null)
  }, [])

  function getAgentSpend(agentId: string): number {
    if (!costs) return 0
    const keys = AGENT_SPEND_KEYS[agentId] ?? [agentId]
    // Approximate spend split across agents: for now show proportional share of total
    // Since costs API doesn't break down by agent, show total/5 as placeholder
    // A future enhancement would tag sessions by agent
    void keys
    return costs.totalEstimatedCostUSD / 5
  }

  async function saveBudget(agent: AgentData) {
    const num = parseFloat(editValue)
    if (isNaN(num) || num < 0) {
      setEditingId(null)
      return
    }
    setSaving(agent.id)
    try {
      const res = await fetch(`/api/agents/${agent.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ budget: num }),
      })
      if (res.ok) {
        const updated = await res.json() as AgentData
        setAgents((prev) => prev.map((a) => (a.id === updated.id ? { ...a, budget: updated.budget } : a)))
      }
    } catch {
      // ignore
    }
    setSaving(null)
    setEditingId(null)
  }

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-white">Agent Budgets</h2>
        <p className="text-xs text-zinc-500 mt-0.5">Monthly spending caps per agent</p>
      </div>
      <div className="rounded-xl overflow-hidden" style={{ backgroundColor: "#111118", border: "1px solid #1a1a2e" }}>
        {agents.length === 0 ? (
          <div className="p-6 text-center text-xs text-zinc-600">Loading...</div>
        ) : (
          <div className="divide-y divide-zinc-800/40">
            {agents.map((agent) => {
              const budget = agent.budget ?? 0
              const spend = getAgentSpend(agent.id)
              const pct = budget > 0 ? Math.min((spend / budget) * 100, 100) : 0
              const barColor = pct > 90 ? "#ef4444" : pct > 70 ? "#f59e0b" : "#22c55e"
              return (
                <div key={agent.id} className="flex items-center gap-4 px-5 py-4">
                  <span className="text-xl shrink-0">{agent.emoji}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-sm font-medium text-white">{agent.name}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-zinc-500">${spend.toFixed(2)} /</span>
                        {editingId === agent.id ? (
                          <form
                            className="flex items-center gap-1"
                            onSubmit={(e) => { e.preventDefault(); saveBudget(agent) }}
                          >
                            <span className="text-xs text-zinc-400">$</span>
                            <input
                              type="number"
                              min="0"
                              step="5"
                              value={editValue}
                              onChange={(e) => setEditValue(e.target.value)}
                              onBlur={() => saveBudget(agent)}
                              autoFocus
                              className="w-16 text-xs rounded px-1.5 py-0.5 text-white outline-none"
                              style={{ backgroundColor: "#0a0a0f", border: "1px solid #7c3aed" }}
                            />
                          </form>
                        ) : (
                          <button
                            onClick={() => { setEditingId(agent.id); setEditValue(String(budget)) }}
                            className="text-xs font-medium transition-colors hover:text-white"
                            style={{ color: agent.accent }}
                          >
                            {saving === agent.id ? "Saving…" : `$${budget}`}
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="h-1 rounded-full bg-zinc-800 overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{ width: `${pct}%`, backgroundColor: barColor }}
                      />
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </section>
  )
}

// ── Section: Crons ─────────────────────────────────────────────────────────────

function CronsSection() {
  const [crons, setCrons] = useState<CronJob[]>([])
  const [loading, setLoading] = useState(true)
  const [toggling, setToggling] = useState<string | null>(null)

  useEffect(() => {
    fetch("/api/settings/crons")
      .then((r) => r.json())
      .then((d: CronJob[]) => { setCrons(Array.isArray(d) ? d : []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  async function toggleCron(cron: CronJob) {
    setToggling(cron.id)
    try {
      const res = await fetch(`/api/settings/crons/${cron.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !cron.enabled }),
      })
      if (res.ok) {
        setCrons((prev) =>
          prev.map((c) => (c.id === cron.id ? { ...c, enabled: !cron.enabled } : c))
        )
      }
    } catch {
      // ignore
    }
    setToggling(null)
  }

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-white">Scheduled Jobs</h2>
        <p className="text-xs text-zinc-500 mt-0.5">OpenClaw cron tasks — toggle to enable/disable</p>
      </div>
      <div className="rounded-xl overflow-hidden" style={{ backgroundColor: "#111118", border: "1px solid #1a1a2e" }}>
        {loading ? (
          <div className="p-6 text-center text-xs text-zinc-600">Loading...</div>
        ) : crons.length === 0 ? (
          <div className="p-6 text-center text-xs text-zinc-600">No cron jobs configured</div>
        ) : (
          <div className="divide-y divide-zinc-800/40">
            {crons.map((cron) => (
              <div key={cron.id} className="flex items-center gap-4 px-5 py-4">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-white truncate">{cron.name}</p>
                  <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                    <span className="text-[11px] font-mono text-zinc-500">{cron.schedule}</span>
                    <span className="text-[11px] text-zinc-600">
                      {cron.lastRunAt ? `Last: ${relativeTime(cron.lastRunAt)}` : "Never run"}
                    </span>
                    {cron.nextRunAt && (
                      <span className="text-[11px] text-zinc-700">
                        Next: {relativeTime(cron.nextRunAt)}
                      </span>
                    )}
                    {cron.lastStatus === "error" && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
                        style={{ backgroundColor: "rgba(239,68,68,0.15)", color: "#ef4444" }}>
                        {cron.consecutiveErrors}x error
                      </span>
                    )}
                    {cron.lastStatus === "ok" && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
                        style={{ backgroundColor: "rgba(34,197,94,0.15)", color: "#22c55e" }}>
                        ✓ ok
                      </span>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => toggleCron(cron)}
                  disabled={toggling === cron.id}
                  className="relative inline-flex h-5 w-9 items-center rounded-full transition-colors shrink-0"
                  style={{ backgroundColor: cron.enabled ? "#22c55e" : "#3f3f46" }}
                >
                  <span
                    className="inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform"
                    style={{ transform: cron.enabled ? "translateX(18px)" : "translateX(2px)" }}
                  />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

// ── Section: Connected Services ────────────────────────────────────────────────

function ConnectedServicesSection() {
  const [services, setServices] = useState<ServiceStatus[]>([])
  const [loading, setLoading] = useState(true)

  const SERVICE_ICONS: Record<string, string> = {
    openclaw: "⚡",
    google: "📅",
    github: "🐙",
    moonpay: "🌕",
  }

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/settings/status")
      const d = await res.json() as ServiceStatus[]
      setServices(Array.isArray(d) ? d : [])
    } catch {
      // ignore
    }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-white">Connected Services</h2>
          <p className="text-xs text-zinc-500 mt-0.5">Real-time connectivity status</p>
        </div>
        <button
          onClick={load}
          className="text-xs font-medium transition-colors hover:text-white"
          style={{ color: "#06b6d4" }}
        >
          Refresh
        </button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {loading
          ? Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="rounded-xl p-4 animate-pulse"
                style={{ backgroundColor: "#111118", border: "1px solid #1a1a2e" }}
              >
                <div className="h-3 bg-zinc-800 rounded w-24 mb-2" />
                <div className="h-2 bg-zinc-800/50 rounded w-32" />
              </div>
            ))
          : services.map((svc) => (
              <div
                key={svc.id}
                className="rounded-xl p-4 space-y-2"
                style={{
                  backgroundColor: "#111118",
                  border: `1px solid ${svc.connected ? "rgba(34,197,94,0.2)" : "rgba(239,68,68,0.2)"}`,
                }}
              >
                <div className="flex items-center gap-2.5">
                  <div
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: svc.connected ? "#22c55e" : "#ef4444" }}
                  />
                  <span className="text-base">{SERVICE_ICONS[svc.id] ?? "🔌"}</span>
                  <span className="text-sm font-medium text-white">{svc.name}</span>
                </div>
                <p className="text-[11px] text-zinc-500 pl-5">{svc.description}</p>
                {svc.error && (
                  <p className="text-[11px] pl-5 truncate" style={{ color: "#ef4444" }}>
                    {svc.error}
                  </p>
                )}
                <div className="pl-5">
                  <span
                    className="text-[10px] font-medium px-2 py-0.5 rounded-full"
                    style={{
                      backgroundColor: svc.connected ? "rgba(34,197,94,0.12)" : "rgba(239,68,68,0.12)",
                      color: svc.connected ? "#22c55e" : "#ef4444",
                    }}
                  >
                    {svc.connected ? "Connected" : "Disconnected"}
                  </span>
                </div>
              </div>
            ))}
      </div>
    </section>
  )
}

// ── Section: Notifications ─────────────────────────────────────────────────────

const NOTIFICATION_KEYS: Array<{ key: keyof NotificationSettings; label: string; description: string }> = [
  { key: "taskActivationAlerts", label: "Task activation alerts", description: "Notify when a task is moved to In Progress" },
  { key: "agentCompletionToasts", label: "Agent completion toasts", description: "Toast when an agent finishes a task" },
  { key: "scoutSignalAlerts", label: "Scout signal alerts", description: "Push when Scout finds high-value intel" },
  { key: "dealFlowDigest", label: "Deal Flow digest", description: "Daily summary of tracked deals and partnerships" },
  { key: "baronDailyReport", label: "Baron daily report", description: "Morning portfolio and DeFi position summary" },
]

function NotificationsSection() {
  const [settings, setSettings] = useState<NotificationSettings | null>(null)
  const [saving, setSaving] = useState<string | null>(null)

  useEffect(() => {
    fetch("/api/settings/notifications")
      .then((r) => r.json())
      .then((d: NotificationSettings) => setSettings(d))
      .catch(() => null)
  }, [])

  async function toggle(key: keyof NotificationSettings) {
    if (!settings) return
    const updated = { ...settings, [key]: !settings[key] }
    setSettings(updated)
    setSaving(key)
    try {
      await fetch("/api/settings/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [key]: updated[key] }),
      })
    } catch {
      // revert
      setSettings(settings)
    }
    setSaving(null)
  }

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-white">Notifications</h2>
        <p className="text-xs text-zinc-500 mt-0.5">Control which alerts you receive</p>
      </div>
      <div className="rounded-xl overflow-hidden" style={{ backgroundColor: "#111118", border: "1px solid #1a1a2e" }}>
        {!settings ? (
          <div className="p-6 text-center text-xs text-zinc-600">Loading...</div>
        ) : (
          <div className="divide-y divide-zinc-800/40">
            {NOTIFICATION_KEYS.map(({ key, label, description }) => {
              const enabled = settings[key]
              return (
                <div key={key} className="flex items-center gap-4 px-5 py-4">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-white">{label}</p>
                    <p className="text-[11px] text-zinc-500 mt-0.5">{description}</p>
                  </div>
                  <button
                    onClick={() => toggle(key)}
                    disabled={saving === key}
                    className="relative inline-flex h-5 w-9 items-center rounded-full transition-colors shrink-0"
                    style={{ backgroundColor: enabled ? "#7c3aed" : "#3f3f46" }}
                  >
                    <span
                      className="inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform"
                      style={{ transform: enabled ? "translateX(18px)" : "translateX(2px)" }}
                    />
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </section>
  )
}

// ── Section: Danger Zone ─────────────────────────────────────────────────────

function DangerZoneSection() {
  const [confirming, setConfirming] = useState(false)
  const [resetting, setResetting] = useState(false)

  async function resetSetup() {
    setResetting(true)
    try {
      await fetch("/api/setup/complete", { method: "DELETE" })
      window.location.href = "/setup"
    } catch {
      setResetting(false)
      setConfirming(false)
    }
  }

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-white">Danger Zone</h2>
        <p className="text-xs text-zinc-500 mt-0.5">Irreversible actions</p>
      </div>
      <div
        className="rounded-xl p-5 space-y-3"
        style={{ backgroundColor: "#111118", border: "1px solid rgba(239,68,68,0.15)" }}
      >
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-white">Reset Setup Wizard</p>
            <p className="text-[11px] text-zinc-500 mt-0.5">
              Re-run the onboarding wizard. Your <code className="text-zinc-400">.env.local</code> will not be deleted.
            </p>
          </div>
          {confirming ? (
            <div className="flex items-center gap-2">
              <button
                onClick={resetSetup}
                disabled={resetting}
                className="text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
                style={{ backgroundColor: "rgba(239,68,68,0.15)", color: "#ef4444" }}
              >
                {resetting ? "Resetting..." : "Confirm Reset"}
              </button>
              <button
                onClick={() => setConfirming(false)}
                className="text-xs text-zinc-500 hover:text-zinc-300 px-2 py-1.5"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirming(true)}
              className="text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
              style={{ backgroundColor: "rgba(239,68,68,0.1)", color: "#ef4444", border: "1px solid rgba(239,68,68,0.2)" }}
            >
              Reset
            </button>
          )}
        </div>
      </div>
    </section>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-white">Settings</h1>
        <p className="text-sm text-zinc-500 mt-1">Agent configuration, integrations, and preferences</p>
      </div>

      <AgentBudgetsSection />
      <DevicesSection />
      <CronsSection />
      <ConnectedServicesSection />
      <NotificationsSection />
      <DangerZoneSection />
    </div>
  )
}
