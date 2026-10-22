"use client"

import { useCallback, useEffect, useState } from "react"
import PlanReviewCard from "./PlanReviewCard"

// Background runs (P2). Shows queued / running / awaiting-approval state from task_run_events.
// Approve and reject only appear on awaiting_approval runs; the server re-checks the owner on every call.

interface RunEvent {
  id: string
  kind: string
  data: Record<string, unknown>
  createdAt: string
}

interface Run {
  id: string
  agentKey: string
  target: string
  status: string
  payload: Record<string, unknown>
  budgetCents: number
  spentCents: number
  error: string | null
  output: string | null
  createdAt: string
  updatedAt: string
  events: RunEvent[]
}

const STATUS_META: Record<string, { label: string; color: string }> = {
  queued: { label: "Queued", color: "#62657a" },
  leased: { label: "Starting", color: "#f59e0b" },
  running: { label: "Running", color: "#f59e0b" },
  awaiting_approval: { label: "Needs approval", color: "#e7c979" },
  succeeded: { label: "Done", color: "#22c55e" },
  failed: { label: "Failed", color: "#ef4444" },
  cancelled: { label: "Cancelled", color: "#62657a" },
}

const REFRESH_MS = 10_000

function dollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

function pendingAction(run: Run): Record<string, unknown> | null {
  const requested = [...run.events].reverse().find((e) => e.kind === "approval_requested")
  return requested ? requested.data : null
}

function lastSummary(run: Run): string {
  const last = run.events[run.events.length - 1]
  return last ? last.kind.replace(/_/g, " ") : ""
}

export default function RunsPanel() {
  const [runs, setRuns] = useState<Run[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [homeOnline, setHomeOnline] = useState<boolean | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/runs", { cache: "no-store" })
      if (res.status === 401) {
        setRuns([])
        return
      }
      if (!res.ok) throw new Error("load failed")
      const data = (await res.json()) as { runs: Run[]; homeOnline?: boolean }
      setRuns(data.runs)
      setHomeOnline(typeof data.homeOnline === "boolean" ? data.homeOnline : null)
      setError(null)
    } catch {
      setError("Could not load background runs.")
    }
  }, [])

  useEffect(() => {
    load()
    const timer = setInterval(load, REFRESH_MS)
    return () => clearInterval(timer)
  }, [load])

  async function decide(runId: string, decision: "approve" | "reject") {
    setBusy(runId)
    try {
      const res = await fetch(`/api/runs/${encodeURIComponent(runId)}/${decision}`, { method: "POST" })
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        setError(`Could not ${decision}: ${data.error ?? res.status}`)
      }
    } finally {
      setBusy(null)
      await load()
    }
  }

  if (runs === null) return null
  if (runs.length === 0 && !error) return null

  const needs = runs.filter((r) => r.status === "awaiting_approval").length

  return (
    <section className="mx-auto mb-6 w-full max-w-[1100px] px-4 sm:px-6" aria-label="Background runs">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-[15px] font-semibold" style={{ color: "var(--ink)" }}>
          Background runs
        </h2>
        <span className="text-[12px]" style={{ color: "var(--ink-3)" }}>
          {needs > 0 ? `${needs} waiting on you` : `${runs.length} recent`}
        </span>
      </div>
      {error && (
        <p className="mb-3 text-[12px]" style={{ color: "#ef4444" }} role="alert">
          {error}
        </p>
      )}
      <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {runs.map((run) => {
          const meta = STATUS_META[run.status] ?? { label: run.status, color: "#62657a" }
          const waitingForLaptop = run.target === "home" && run.status === "queued" && homeOnline === false
          const prompt = typeof run.payload.prompt === "string" ? run.payload.prompt : ""
          const action = run.status === "awaiting_approval" ? pendingAction(run) : null
          return (
            <li
              key={run.id}
              className="flex min-w-0 flex-col gap-2 rounded-xl p-4"
              style={{ background: "var(--surface-1, #14151c)", border: "1px solid var(--line, rgba(255,255,255,0.08))" }}
            >
              <div className="flex items-start justify-between gap-3">
                <p className="line-clamp-2 min-w-0 text-[14px]" style={{ color: "var(--ink)" }}>
                  {prompt || "Background run"}
                </p>
                <span
                  className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium"
                  style={{ color: meta.color, background: `${meta.color}1f` }}
                >
                  {waitingForLaptop ? "Waiting for your laptop" : meta.label}
                </span>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px]" style={{ color: "var(--ink-3)" }}>
                <span>
                  {dollars(run.spentCents)} of {dollars(run.budgetCents)} spent
                </span>
                <span>{run.agentKey}</span>
                <span>{run.target}</span>
                {lastSummary(run) && <span>last: {lastSummary(run)}</span>}
              </div>
              {action && (
                <div className="rounded-lg p-3 text-[13px]" style={{ background: "rgba(231,201,121,0.08)", color: "var(--ink-2)" }}>
                  <p className="font-medium" style={{ color: "var(--ink)" }}>
                    {String(action.type ?? "money action")}
                    {typeof action.amountCents === "number" ? ` · ${dollars(action.amountCents)}` : ""}
                  </p>
                  {typeof action.destination === "string" && <p>To: {action.destination}</p>}
                  {typeof action.description === "string" && <p>{action.description}</p>}
                  <p className="mt-1 text-[12px]" style={{ color: "var(--ink-3)" }}>
                    Nothing moves until you approve. Approval runs the action once.
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={busy === run.id}
                      onClick={() => decide(run.id, "approve")}
                      className="rounded-full px-3 py-1.5 text-[12px] font-medium disabled:opacity-40"
                      style={{ background: "var(--ink)", color: "var(--surface-0, #0b0c10)" }}
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      disabled={busy === run.id}
                      onClick={() => decide(run.id, "reject")}
                      className="rounded-full px-3 py-1.5 text-[12px] disabled:opacity-40"
                      style={{ color: "var(--ink-2)", border: "1px solid var(--line, rgba(255,255,255,0.12))" }}
                    >
                      Reject
                    </button>
                  </div>
                </div>
              )}
              {run.status === "succeeded" && run.output && (
                <p className="line-clamp-4 whitespace-pre-wrap text-[13px]" style={{ color: "var(--ink-2)" }}>
                  {run.output}
                </p>
              )}
              {run.status === "succeeded" && (
                <PlanReviewCard
                  run={run}
                  taskId={typeof run.payload.taskId === "string" ? run.payload.taskId : undefined}
                />
              )}
              {run.error && (run.status === "failed" || run.status === "cancelled") && (
                <p className="text-[12px]" style={{ color: "#ef4444" }}>
                  {run.error}
                </p>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
