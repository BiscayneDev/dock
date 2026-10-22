"use client"

import { useEffect, useState } from "react"
import { Check, X, Loader2, ScrollText } from "lucide-react"

// Brief cards and the project ledger (central thread v1). The owner's Approve is the only way work starts.

export type BriefState = "proposed" | "approved" | "running" | "succeeded" | "failed" | "cancelled"

export interface BriefView {
  id: string
  agentKey: string
  goal: string
  context: string
  deliverables: string[]
  budgetCents: number
  riskFlags: string[]
  state: BriefState
  outputSummary: string
  error: string | null
  updatedAt: string
}

export interface LedgerView {
  id: string
  kind: string
  agentKey: string
  summary: string
  costCents: number | null
  createdAt: string
}

const STATE_LABEL: Record<BriefState, string> = {
  proposed: "Needs approval",
  approved: "Starting",
  running: "Working",
  succeeded: "Done",
  failed: "Stopped",
  cancelled: "Cancelled",
}

const STATE_COLOR: Record<BriefState, string> = {
  proposed: "#dfa33c",
  approved: "#7aa7ff",
  running: "#7aa7ff",
  succeeded: "#4fbf8b",
  failed: "#e06c6c",
  cancelled: "var(--ink-3)",
}

const RISK_LABEL: Record<string, string> = {
  spends_money: "Spends money",
  contacts_people: "Contacts people",
  publishes_externally: "Publishes externally",
  deletes_data: "Deletes data",
}

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`

export function BriefCard({ briefId, onSettled }: { briefId: string; onSettled?: () => void }) {
  const [brief, setBrief] = useState<BriefView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    async function load() {
      try {
        const res = await fetch(`/api/briefs/${briefId}`, { cache: "no-store" })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = (await res.json()) as BriefView
        if (cancelled) return
        setBrief(data)
        if (data.state === "approved" || data.state === "running") timer = setTimeout(load, 4000)
      } catch {
        if (!cancelled) setError("Could not load this brief.")
      }
    }
    load()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [briefId])

  // Refresh the card once the run settles so the thread shows the result message.
  const settledState = brief?.state
  useEffect(() => {
    if (settledState === "succeeded" || settledState === "failed") onSettled?.()
  }, [settledState, onSettled])

  async function decide(action: "approve" | "cancel") {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/briefs/${briefId}/${action}`, { method: "POST" })
      const data = (await res.json().catch(() => ({}))) as { error?: string; brief?: BriefView }
      if (!res.ok) {
        setError(data.error ?? "Could not update this brief.")
        return
      }
      if (data.brief) setBrief(data.brief)
      else {
        const refreshed = await fetch(`/api/briefs/${briefId}`, { cache: "no-store" })
        if (refreshed.ok) setBrief((await refreshed.json()) as BriefView)
      }
    } catch {
      setError("Network error. Nothing was started.")
    } finally {
      setBusy(false)
    }
  }

  if (!brief) {
    return (
      <div className="rounded-[14px] border p-4 text-[13px]" style={{ borderColor: "var(--border)", color: "var(--ink-3)" }}>
        {error ?? "Loading brief…"}
      </div>
    )
  }

  const proposed = brief.state === "proposed"
  return (
    <section
      aria-label={`Brief: ${brief.goal}`}
      className="flex flex-col gap-3 rounded-[14px] border p-4"
      style={{ borderColor: "var(--border)", background: "var(--card)" }}
    >
      <header className="flex items-center justify-between gap-3">
        <p className="text-[12px] font-medium uppercase tracking-wide" style={{ color: "var(--ink-3)" }}>
          Brief · {brief.agentKey}
        </p>
        <span className="flex items-center gap-1.5 text-[12px] font-medium" style={{ color: STATE_COLOR[brief.state] }}>
          {brief.state === "running" || brief.state === "approved" ? (
            <Loader2 size={12} className="animate-spin" />
          ) : brief.state === "succeeded" ? (
            <Check size={12} />
          ) : brief.state === "failed" || brief.state === "cancelled" ? (
            <X size={12} />
          ) : null}
          {STATE_LABEL[brief.state]}
        </span>
      </header>

      <p className="text-[15px] font-medium leading-snug" style={{ color: "var(--ink)" }}>
        {brief.goal}
      </p>

      {brief.context && (
        <p className="whitespace-pre-wrap text-[13px] leading-relaxed" style={{ color: "var(--ink-2)" }}>
          {brief.context}
        </p>
      )}

      <ul className="flex flex-col gap-1 text-[13px]" style={{ color: "var(--ink-2)" }}>
        {brief.deliverables.map((d, i) => (
          <li key={i} className="flex gap-2">
            <span style={{ color: "var(--ink-3)" }}>{i + 1}.</span>
            <span>{d}</span>
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap items-center gap-2 text-[12px]" style={{ color: "var(--ink-3)" }}>
        <span>Budget cap {money(brief.budgetCents)}</span>
        {brief.riskFlags.map((flag) => (
          <span
            key={flag}
            className="rounded-full border px-2 py-0.5"
            style={{ borderColor: "#dfa33c", color: "#dfa33c" }}
          >
            {RISK_LABEL[flag] ?? flag}
          </span>
        ))}
      </div>

      {brief.state === "succeeded" && brief.outputSummary && (
        <p className="line-clamp-3 text-[13px]" style={{ color: "var(--ink-2)" }}>
          {brief.outputSummary}
        </p>
      )}
      {brief.state === "failed" && brief.error && (
        <p className="text-[13px]" style={{ color: "#e06c6c" }}>
          {brief.error}
        </p>
      )}

      {proposed && (
        <div className="flex items-center gap-2 pt-1">
          <button
            type="button"
            disabled={busy}
            onClick={() => decide("approve")}
            className="rounded-full px-4 py-1.5 text-[13px] font-medium disabled:opacity-50"
            style={{ background: "var(--accent)", color: "var(--accent-ink, #fff)" }}
          >
            {busy ? "Starting…" : "Approve and start"}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => decide("cancel")}
            className="rounded-full px-3 py-1.5 text-[13px] hover:bg-white/5 disabled:opacity-50"
            style={{ color: "var(--ink-3)" }}
          >
            Cancel
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="text-[12px]" style={{ color: "#e06c6c" }}>
          {error}
        </p>
      )}
    </section>
  )
}

const KIND_LABEL: Record<string, string> = {
  brief_proposed: "Proposed",
  brief_cancelled: "Cancelled",
  run_started: "Started",
  run_succeeded: "Done",
  run_failed: "Stopped",
}

interface SpendView {
  capCents: number | null
  spentCents: number
  reservedCents: number
}

/** This month's spend against the project's monthly cap, with the owner's control to set or clear it. */
function SpendControl({ projectId, refreshKey }: { projectId: string; refreshKey: number }) {
  const [spend, setSpend] = useState<SpendView | null>(null)
  const [draft, setDraft] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/projects/${projectId}/spend`, { cache: "no-store" })
      .then(async (res) => (res.ok ? ((await res.json()) as SpendView) : null))
      .then((data) => {
        if (!cancelled && data) {
          setSpend(data)
          setDraft(data.capCents === null ? "" : String(data.capCents / 100))
        }
      })
      .catch(() => null)
    return () => {
      cancelled = true
    }
  }, [projectId, refreshKey])

  async function save(capCents: number | null) {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/projects/${projectId}/spend`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ capCents }),
      })
      const data = (await res.json().catch(() => ({}))) as SpendView & { error?: string }
      if (!res.ok) {
        setError(data.error ?? "Could not save the cap.")
        return
      }
      setSpend(data)
    } catch {
      setError("Network error. The cap was not changed.")
    } finally {
      setSaving(false)
    }
  }

  if (!spend) return null
  const used = spend.spentCents + spend.reservedCents
  const over = spend.capCents !== null && used > spend.capCents
  return (
    <div className="flex flex-col gap-2 rounded-[12px] border p-3 text-[13px]" style={{ borderColor: "var(--border)" }}>
      <p style={{ color: over ? "#e06c6c" : "var(--ink-2)" }}>
        This month: {money(spend.spentCents)} spent · {money(spend.reservedCents)} reserved
        {spend.capCents !== null ? ` · cap ${money(spend.capCents)}` : " · no cap"}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1.5 text-[12px]" style={{ color: "var(--ink-3)" }}>
          Monthly cap $
          <input
            inputMode="decimal"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="none"
            aria-label="Monthly spend cap in dollars"
            className="w-24 rounded-md border bg-transparent px-2 py-1 text-[13px]"
            style={{ borderColor: "var(--border)", color: "var(--ink)" }}
          />
        </label>
        <button
          type="button"
          disabled={saving}
          onClick={() => {
            const trimmed = draft.trim()
            if (trimmed === "") return save(null)
            const dollars = Number(trimmed)
            if (!Number.isFinite(dollars) || dollars < 0) {
              setError("Enter a dollar amount, or leave blank for no cap.")
              return
            }
            return save(Math.round(dollars * 100))
          }}
          className="rounded-full px-3 py-1 text-[12px] font-medium hover:bg-white/5 disabled:opacity-50"
          style={{ color: "var(--ink)" }}
        >
          {saving ? "Saving…" : "Save cap"}
        </button>
      </div>
      {error && (
        <p role="alert" className="text-[12px]" style={{ color: "#e06c6c" }}>
          {error}
        </p>
      )}
    </div>
  )
}

/** The project's ledger: what was proposed, approved, run and finished. Read-only; newest first. */
export function LedgerPanel({ projectId, refreshKey }: { projectId: string; refreshKey: number }) {
  const [entries, setEntries] = useState<LedgerView[] | null>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    fetch(`/api/ledger?projectId=${encodeURIComponent(projectId)}`, { cache: "no-store" })
      .then(async (res) => (res.ok ? ((await res.json()) as LedgerView[]) : []))
      .then((data) => {
        if (!cancelled) setEntries(data)
      })
      .catch(() => {
        if (!cancelled) setEntries([])
      })
    return () => {
      cancelled = true
    }
  }, [open, projectId, refreshKey])

  return (
    <div className="mx-auto w-full max-w-[680px] px-6">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] hover:bg-white/5"
        style={{ color: "var(--ink-3)" }}
      >
        <ScrollText size={12} /> Ledger & spend
      </button>
      {open && <div className="mt-2"><SpendControl projectId={projectId} refreshKey={refreshKey} /></div>}
      {open && (
        <ol className="mt-2 flex flex-col gap-2 border-l pl-4" style={{ borderColor: "var(--border)" }}>
          {entries === null && <li className="text-[12px]" style={{ color: "var(--ink-3)" }}>Loading…</li>}
          {entries?.length === 0 && (
            <li className="text-[12px]" style={{ color: "var(--ink-3)" }}>
              No work yet. Approved briefs and their outcomes appear here.
            </li>
          )}
          {entries?.map((e) => (
            <li key={e.id} className="text-[13px]" style={{ color: "var(--ink-2)" }}>
              <span className="font-medium" style={{ color: "var(--ink)" }}>
                {KIND_LABEL[e.kind] ?? e.kind}
              </span>{" "}
              · {e.agentKey} · {e.summary}
              {e.costCents !== null && e.costCents > 0 && (
                <span style={{ color: "var(--ink-3)" }}> · {money(e.costCents)}</span>
              )}
              <span className="block text-[11px]" style={{ color: "var(--ink-3)" }}>
                {new Date(e.createdAt).toLocaleString()}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
