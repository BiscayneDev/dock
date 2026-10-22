"use client"

import { useMemo, useState } from "react"
import { parsePlanGraph, topoOrder, type PlanNode } from "@/lib/plan-graph"

// Plan review (P7): a plan-mode run's output ends with a ```plan graph block.
// This card parses it, shows the ordered steps with dependencies, and — when the
// run is linked to a task — promotes the task to In Progress and enqueues one
// build run per node in topological order via the existing /api/runs endpoint.

interface PlanReviewRun {
  id: string
  payload: Record<string, unknown>
  output: string | null
}

function dollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

export default function PlanReviewCard({ run, taskId }: { run: PlanReviewRun; taskId?: string }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const parsed = useMemo(() => {
    const payload = run.payload as Record<string, unknown>
    if (payload.planOutput !== true || typeof run.output !== "string") return null
    try {
      const nodes = parsePlanGraph(run.output)
      return { order: topoOrder(nodes) }
    } catch {
      return null
    }
  }, [run.output, run.payload])

  if (!parsed) return null
  const { order } = parsed

  const totalCents = order.reduce((sum: number, n: PlanNode) => sum + (n.estimateCents ?? 0), 0)

  async function approveAndExecute() {
    if (!taskId) return
    setBusy(true)
    setError(null)
    try {
      // Promote the task to In Progress via the tasks API the board already uses.
      const patch = await fetch(`/api/tasks/${encodeURIComponent(taskId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ column: "in-progress" }),
      })
      if (!patch.ok) throw new Error(`task update failed (${patch.status})`)
      // Enqueue one run per node in dependency order via the existing runs endpoint.
      for (const node of order) {
        const res = await fetch("/api/runs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt: node.title,
            agent: node.agentKey ?? "chief",
            ...(node.estimateCents ? { budget_cents: Math.max(1, Math.round(node.estimateCents)) } : {}),
          }),
        })
        if (!res.ok) throw new Error(`run enqueue failed for "${node.title}" (${res.status})`)
      }
      setDone(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : "approve failed")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-lg p-3 text-[13px]" style={{ background: "rgba(124,58,237,0.08)", color: "var(--ink-2)" }}>
      <p className="font-medium" style={{ color: "var(--ink)" }}>
        Proposed plan · {order.length} step{order.length === 1 ? "" : "s"}
        {totalCents > 0 ? ` · est. ${dollars(totalCents)}` : ""}
      </p>
      <ol className="mt-2 ml-4 list-decimal space-y-1">
        {order.map((node) => (
          <li key={node.id}>
            <span style={{ color: "var(--ink)" }}>{node.title}</span>
            {node.agentKey ? <span style={{ color: "var(--ink-3)" }}> · {node.agentKey}</span> : null}
            {node.estimateCents ? <span style={{ color: "var(--ink-3)" }}> · {dollars(node.estimateCents)}</span> : null}
            {node.dependsOn.length > 0 && (
              <span style={{ color: "var(--ink-3)" }}>
                {" "}
                ← after {node.dependsOn.map((d) => order.findIndex((n) => n.id === d) + 1 || d).join(", ")}
              </span>
            )}
          </li>
        ))}
      </ol>
      {error && (
        <p className="mt-2 text-[12px]" style={{ color: "#ef4444" }} role="alert">
          {error}
        </p>
      )}
      {done ? (
        <p className="mt-2 text-[12px]" style={{ color: "#22c55e" }}>
          Approved — task moved to In Progress and child runs enqueued.
        </p>
      ) : (
        <button
          type="button"
          disabled={busy || !taskId}
          title={
            taskId
              ? "Move the task to In Progress and enqueue one run per step"
              : "This run is not linked to a task, so the promote API path is pending — the graph is read-only here"
          }
          onClick={approveAndExecute}
          className="mt-2 rounded-full px-3 py-1.5 text-[12px] font-medium disabled:opacity-40"
          style={{ background: "var(--ink)", color: "var(--surface-0, #0b0c10)" }}
        >
          {busy ? "Approving…" : "Approve & execute"}
        </button>
      )}
    </div>
  )
}
