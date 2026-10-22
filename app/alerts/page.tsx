"use client"

import Link from "next/link"
import { useCallback, useEffect, useState } from "react"

interface AlertRecord {
  id: string
  type: string
  severity: "info" | "warning" | "critical"
  status: "open" | "acknowledged" | "resolved" | "snoozed"
  title: string
  summary: string
  conversationId?: string
  runId?: string
  taskId?: string
  createdAt: string
  updatedAt: string
}

const SEVERITY_STYLES: Record<AlertRecord["severity"], { bg: string; border: string; color: string; label: string }> = {
  info: { bg: "rgba(59,130,246,0.12)", border: "rgba(59,130,246,0.24)", color: "#60a5fa", label: "Info" },
  warning: { bg: "rgba(245,158,11,0.12)", border: "rgba(245,158,11,0.24)", color: "#fbbf24", label: "Warning" },
  critical: { bg: "rgba(239,68,68,0.12)", border: "rgba(239,68,68,0.24)", color: "#f87171", label: "Critical" },
}

const STATUS_STYLES: Record<AlertRecord["status"], { bg: string; color: string; label: string }> = {
  open: { bg: "rgba(239,68,68,0.12)", color: "#f87171", label: "Open" },
  acknowledged: { bg: "rgba(59,130,246,0.12)", color: "#60a5fa", label: "Acknowledged" },
  resolved: { bg: "rgba(34,197,94,0.12)", color: "#4ade80", label: "Resolved" },
  snoozed: { bg: "rgba(113,113,122,0.15)", color: "#a1a1aa", label: "Snoozed" },
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  const hrs = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins}m ago`
  if (hrs < 24) return `${hrs}h ago`
  if (days < 7) return `${days}d ago`
  return new Date(iso).toLocaleDateString()
}

interface RunFailure {
  id: string
  agentKey: string
  error: string | null
  finishedAt: string | null
  model: string | null
  attempts: number
}

export default function AlertsPage() {
  const [alerts, setAlerts] = useState<AlertRecord[]>([])
  const [failures, setFailures] = useState<RunFailure[]>([])
  const [loading, setLoading] = useState(true)
  const [pendingId, setPendingId] = useState<string>("")

  const fetchAlerts = useCallback(async () => {
    try {
      const res = await fetch("/api/alerts", { cache: "no-store" })
      const data = (await res.json()) as AlertRecord[]
      setAlerts(Array.isArray(data) ? data : [])
    } catch {
      setAlerts([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchAlerts().catch(() => null)
    fetch("/api/runs/failures", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => setFailures(Array.isArray(data) ? data : []))
      .catch(() => setFailures([]))
  }, [fetchAlerts])

  async function updateStatus(id: string, status: "acknowledged" | "resolved") {
    setPendingId(id)
    try {
      const res = await fetch(`/api/alerts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      })
      if (!res.ok) return
      const updated = (await res.json()) as AlertRecord
      setAlerts((current) => current.map((alert) => (alert.id === id ? updated : alert)))
    } finally {
      setPendingId("")
    }
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-12">
      <div>
        <h1 className="text-3xl font-bold text-white">Alerts</h1>
        <p className="mt-1 text-sm text-zinc-500">Canonical failed-run inbox.</p>
      </div>

      <section className="rounded-xl p-4" style={{ backgroundColor: "#111118", border: "1px solid #1a1a2e" }}>
        <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">Recent failures</h2>
        <p className="mt-1 text-xs text-zinc-600">Last 50 failed runs with their error output.</p>
        {failures.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-600">No failed runs.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {failures.map((f) => (
              <li key={f.id} className="rounded-lg px-3 py-2" style={{ backgroundColor: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.18)" }}>
                <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                  <span className="font-mono text-zinc-400">{f.agentKey}</span>
                  {f.model ? <span>{f.model}</span> : null}
                  <span>attempt {f.attempts}</span>
                  {f.finishedAt ? <span>{relativeTime(f.finishedAt)}</span> : null}
                </div>
                <p className="mt-1 break-words text-xs text-zinc-400">
                  {f.error ? f.error.slice(0, 300) : "No error message recorded."}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {loading ? (
        <div className="rounded-xl p-8 text-center" style={{ backgroundColor: "#111118", border: "1px solid #1a1a2e" }}>
          <p className="text-sm text-zinc-600">Loading alerts...</p>
        </div>
      ) : alerts.length === 0 ? (
        <div className="rounded-xl p-12 text-center" style={{ backgroundColor: "#111118", border: "1px solid #1a1a2e" }}>
          <p className="text-2xl mb-3">🛟</p>
          <p className="text-sm text-zinc-400 font-medium">No alerts right now</p>
          <p className="text-xs text-zinc-600 mt-1">Failed runs will appear here automatically.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {alerts.map((alert) => {
            const severity = SEVERITY_STYLES[alert.severity]
            const status = STATUS_STYLES[alert.status]
            const canAcknowledge = alert.status === "open" || alert.status === "snoozed"
            const canResolve = alert.status !== "resolved"

            return (
              <div
                key={alert.id}
                className="rounded-2xl p-4"
                style={{ backgroundColor: "#111118", border: "1px solid #1a1a2e" }}
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className="rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider"
                        style={{ backgroundColor: severity.bg, border: `1px solid ${severity.border}`, color: severity.color }}
                      >
                        {severity.label}
                      </span>
                      <span
                        className="rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider"
                        style={{ backgroundColor: status.bg, color: status.color }}
                      >
                        {status.label}
                      </span>
                      <span className="text-[11px] text-zinc-600">{relativeTime(alert.updatedAt)}</span>
                    </div>

                    <div>
                      <h2 className="text-base font-semibold text-white">{alert.title}</h2>
                      <p className="mt-1 text-sm leading-relaxed text-zinc-400">{alert.summary}</p>
                    </div>

                    <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-500">
                      <span>{new Date(alert.updatedAt).toLocaleString()}</span>
                      {alert.conversationId ? (
                        <Link href={`/conversations?id=${alert.conversationId}`} className="text-violet-300 hover:underline underline-offset-2">
                          Open conversation
                        </Link>
                      ) : null}
                    </div>
                  </div>

                  <div className="flex shrink-0 gap-2">
                    <button
                      onClick={() => updateStatus(alert.id, "acknowledged")}
                      disabled={!canAcknowledge || pendingId === alert.id}
                      className="rounded-lg px-3 py-2 text-xs font-semibold transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
                      style={{ backgroundColor: "rgba(59,130,246,0.12)", border: "1px solid rgba(59,130,246,0.24)", color: "#93c5fd" }}
                    >
                      Acknowledge
                    </button>
                    <button
                      onClick={() => updateStatus(alert.id, "resolved")}
                      disabled={!canResolve || pendingId === alert.id}
                      className="rounded-lg px-3 py-2 text-xs font-semibold transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
                      style={{ backgroundColor: "rgba(34,197,94,0.12)", border: "1px solid rgba(34,197,94,0.24)", color: "#86efac" }}
                    >
                      Resolve
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
