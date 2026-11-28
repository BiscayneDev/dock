"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { DecisionCard } from "./DecisionCard"
import type { InboxCardItem, InboxCounts, InboxResponse } from "./types"

const FILTERS: Array<{ id: "all" | "needs-you" | "running" | "done"; label: string }> = [
  { id: "all", label: "All" },
  { id: "needs-you", label: "Needs you" },
  { id: "running", label: "Running" },
  { id: "done", label: "Done" },
]

const POLL_MS = 15_000

function relative(iso: string): string {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return "—"
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000))
  if (s < 60) return "just now"
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function statusChip(color: string, label: string) {
  return (
    <span
      className="rounded-full px-2 py-0.5 text-[11px] font-medium"
      style={{ color, background: `${color}1f`, border: `1px solid ${color}40` }}
      role="status"
    >
      {label}
    </span>
  )
}

function AlertCard({ item, onChanged }: { item: InboxCardItem; onChanged: () => Promise<void> | void }) {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const id = String(item.raw?.id ?? "")
  const severity = String(item.raw?.severity ?? "info")
  const color = severity === "critical" ? "#f87171" : severity === "warning" ? "#fbbf24" : "#60a5fa"

  async function setStatus(status: "acknowledged" | "resolved" | "snoozed") {
    if (busy) return
    setBusy(status)
    setError(null)
    try {
      const res = await fetch(`/api/alerts/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        setError(data.error ?? "Could not update the alert.")
        return
      }
      await onChanged()
    } catch {
      setError("Could not reach the server.")
    } finally {
      setBusy(null)
    }
  }

  return (
    <li className="flex flex-col gap-2 rounded-[14px] p-4" style={{ background: "var(--surface-1)", border: "1px solid var(--line)" }}>
      <header className="flex items-center justify-between gap-2">
        <span className="text-[11px] uppercase tracking-[0.08em]" style={{ color }}>{severity}</span>
        <span className="text-[12px] tabular-nums" style={{ color: "var(--ink-3)" }}>{relative(item.updatedAt)}</span>
      </header>
      <p className="text-[14px] font-medium" style={{ color: "var(--ink)" }}>{item.title}</p>
      {item.summary ? <p className="text-[13px]" style={{ color: "var(--ink-2)" }}>{item.summary}</p> : null}
      {error ? <p className="text-[12px]" style={{ color: "#f87171" }} role="alert">{error}</p> : null}
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => setStatus("acknowledged")} disabled={busy !== null} className="min-h-[36px] rounded-[8px] px-3 text-[12px] font-medium disabled:opacity-50" style={{ background: "var(--surface-2)", color: "var(--ink)", border: "1px solid var(--line-strong, var(--line))" }}>
          Acknowledge
        </button>
        <button type="button" onClick={() => setStatus("resolved")} disabled={busy !== null} className="min-h-[36px] rounded-[8px] px-3 text-[12px] font-medium disabled:opacity-50" style={{ background: "var(--surface-2)", color: "var(--ink)", border: "1px solid var(--line-strong, var(--line))" }}>
          Resolve
        </button>
        <button type="button" onClick={() => setStatus("snoozed")} disabled={busy !== null} className="min-h-[36px] rounded-[8px] px-3 text-[12px] font-medium disabled:opacity-50" style={{ background: "transparent", color: "var(--ink-2)", border: "1px solid var(--line-strong, var(--line))" }}>
          Snooze
        </button>
      </div>
    </li>
  )
}

function BriefCard({ item, onChanged }: { item: InboxCardItem; onChanged: () => Promise<void> | void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const id = String(item.raw?.id ?? "")
  const actionable = item.status === "proposed"

  async function act(path: "approve" | "cancel") {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/briefs/${encodeURIComponent(id)}/${path}`, { method: "POST" })
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        setError(data.error ?? "Could not update the brief.")
        return
      }
      await onChanged()
    } catch {
      setError("Could not reach the server.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className="flex flex-col gap-2 rounded-[14px] p-4" style={{ background: "var(--surface-1)", border: "1px solid var(--line)" }}>
      <header className="flex items-center justify-between gap-2">
        <span className="text-[11px] uppercase tracking-[0.08em]" style={{ color: "var(--dock-ink-2)" }}>Brief</span>
        <span className="text-[12px] tabular-nums" style={{ color: "var(--ink-3)" }}>{relative(item.updatedAt)}</span>
      </header>
      <p className="text-[14px] font-medium" style={{ color: "var(--ink)" }}>{item.title}</p>
      {item.summary ? <p className="whitespace-pre-wrap text-[13px]" style={{ color: "var(--ink-2)" }}>{item.summary}</p> : null}
      {typeof item.raw?.budgetCents === "number" ? (
        <p className="text-[12px] tabular-nums" style={{ color: "var(--ink-3)" }}>
          Budget ${((item.raw.budgetCents as number) / 100).toFixed(2)} · {item.kind}
        </p>
      ) : null}
      {error ? <p className="text-[12px]" style={{ color: "#f87171" }} role="alert">{error}</p> : null}
      {actionable && (
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => act("approve")} disabled={busy} className="min-h-[36px] rounded-[8px] px-3 text-[12px] font-medium disabled:opacity-50" style={{ background: "var(--ink)", color: "var(--surface-0)" }}>
            Approve brief
          </button>
          <button type="button" onClick={() => act("cancel")} disabled={busy} className="min-h-[36px] rounded-[8px] px-3 text-[12px] font-medium disabled:opacity-50" style={{ background: "transparent", color: "var(--ink-2)", border: "1px solid var(--line-strong, var(--line))" }}>
            Cancel
          </button>
        </div>
      )}
    </li>
  )
}

function RunCard({ item }: { item: InboxCardItem }) {
  const color =
    item.status === "failed" || item.status === "cancelled"
      ? "#f87171"
      : item.status === "awaiting_approval"
        ? "#e7c979"
        : item.status === "succeeded"
          ? "#22c55e"
          : "#f59e0b"
  return (
    <li className="flex flex-col gap-2 rounded-[14px] p-4" style={{ background: "var(--surface-1)", border: "1px solid var(--line)" }}>
      <header className="flex items-center justify-between gap-2">
        <span className="text-[11px] uppercase tracking-[0.08em]" style={{ color: "#f59e0b" }}>Run</span>
        <span className="text-[12px] tabular-nums" style={{ color: "var(--ink-3)" }}>{relative(item.updatedAt)}</span>
      </header>
      <p className="text-[14px] font-medium" style={{ color: "var(--ink)" }}>{item.title}</p>
      <div className="flex flex-wrap items-center gap-2">
        {statusChip(color, item.status)}
        {item.runId ? (
          <Link href={`/tasks`} className="text-[12px] hover:underline" style={{ color: "var(--ink-3)" }}>
            Open work
          </Link>
        ) : null}
      </div>
    </li>
  )
}

function MessageCard({ item }: { item: InboxCardItem }) {
  return (
    <li className="flex flex-col gap-1 rounded-[14px] p-4" style={{ background: "var(--surface-1)", border: "1px solid var(--line)" }}>
      <header className="flex items-center justify-between gap-2">
        <span className="text-[11px] uppercase tracking-[0.08em]" style={{ color: "var(--ink-3)" }}>{item.kind}</span>
        <span className="text-[12px] tabular-nums" style={{ color: "var(--ink-3)" }}>{relative(item.createdAt)}</span>
      </header>
      <p className="text-[13px] leading-relaxed" style={{ color: "var(--ink-2)" }}>{item.summary}</p>
    </li>
  )
}

export function InboxClient() {
  const [filter, setFilter] = useState<"all" | "needs-you" | "running" | "done">("all")
  const [search, setSearch] = useState("")
  const [query, setQuery] = useState("")
  const [data, setData] = useState<InboxResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/inbox?filter=${filter}&q=${encodeURIComponent(query)}`, { cache: "no-store" })
      const json = (await res.json()) as InboxResponse & { error?: string }
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
      setData(json)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the inbox.")
    } finally {
      setLoading(false)
    }
  }, [filter, query])

  useEffect(() => {
    load().catch(() => null)
  }, [load])

  useEffect(() => {
    const timer = window.setInterval(() => load().catch(() => null), POLL_MS)
    return () => window.clearInterval(timer)
  }, [load])

  const counts: InboxCounts = data?.counts ?? { all: 0, "needs-you": 0, running: 0, done: 0 }
  const items = data?.items ?? []

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5" data-testid="inbox">
      <header className="flex flex-col gap-1">
        <h1 className="dock-entry-title" style={{ color: "var(--ink)" }}>Inbox</h1>
        <p className="text-[13px]" style={{ color: "var(--ink-3)" }}>
          Every decision waiting on you, bound to the artifact it was made against.
        </p>
      </header>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" aria-label="Filter inbox" className="flex flex-wrap gap-1 rounded-lg p-1" style={{ background: "var(--surface-1)", border: "1px solid var(--line)" }}>
          {FILTERS.map((f) => {
            const active = filter === f.id
            return (
              <button
                key={f.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setFilter(f.id)}
                className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] transition-colors"
                style={{ background: active ? "var(--surface-3)" : "transparent", color: active ? "var(--ink)" : "var(--ink-3)" }}
              >
                {f.label}
                <span className="tabular-nums rounded px-1 text-[10px]" style={{ background: "var(--surface-2)", color: "var(--ink-2)" }}>
                  {counts[f.id]}
                </span>
              </button>
            )
          })}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            setQuery(search)
          }}
          className="flex items-center gap-2"
        >
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search decisions…"
            aria-label="Search inbox"
            className="min-h-[36px] rounded-[8px] px-3 text-[13px]"
            style={{ background: "var(--surface-1)", color: "var(--ink)", border: "1px solid var(--line)" }}
          />
          <button type="submit" className="min-h-[36px] rounded-[8px] px-3 text-[12px] font-medium" style={{ background: "var(--surface-2)", color: "var(--ink)", border: "1px solid var(--line-strong, var(--line))" }}>
            Search
          </button>
        </form>
      </div>

      {error ? (
        <p className="rounded-xl px-4 py-3 text-[13px]" style={{ color: "#f87171", background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.25)" }} role="alert">
          {error}
        </p>
      ) : null}

      {data?.signedIn === false ? (
        <div className="rounded-xl px-6 py-12 text-center text-[13px]" style={{ background: "var(--surface-1)", border: "1px dashed var(--line-strong)", color: "var(--ink-3)" }}>
          Sign in to see your decisions.
        </div>
      ) : loading ? (
        <div className="rounded-xl px-6 py-12 text-center text-[13px]" style={{ background: "var(--surface-1)", border: "1px dashed var(--line-strong)", color: "var(--ink-3)" }}>
          Loading…
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-xl px-6 py-12 text-center text-[13px]" style={{ background: "var(--surface-1)", border: "1px dashed var(--line-strong)", color: "var(--ink-3)" }}>
          Nothing here. New approvals, questions and alerts land in this queue.
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((item) => {
            if (item.type === "decision") return <DecisionCard key={item.key} item={item} onChanged={load} />
            if (item.type === "alert") return <AlertCard key={item.key} item={item} onChanged={load} />
            if (item.type === "brief") return <BriefCard key={item.key} item={item} onChanged={load} />
            if (item.type === "run") return <RunCard key={item.key} item={item} />
            return <MessageCard key={item.key} item={item} />
          })}
        </ul>
      )}
    </div>
  )
}
