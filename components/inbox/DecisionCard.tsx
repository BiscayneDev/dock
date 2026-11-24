"use client"

import { useState } from "react"
import type { InboxCardItem } from "./types"

// One decision card: artifact + rationale + options inline, one verdict per click, audit trail visible.
// All writes go through PATCH /api/decisions/:id, which enforces expiry, artifact-hash binding,
// reviewer != producer and the reason requirement for changes_requested.

const KIND_LABEL: Record<string, string> = {
  approval: "Approval",
  review: "Review",
  question: "Question",
  blocker: "Blocker",
}

const STATUS_STYLE: Record<string, { color: string; label: string }> = {
  pending: { color: "#e7c979", label: "Waiting for you" },
  approved: { color: "#22c55e", label: "Approved" },
  edited_accepted: { color: "#22c55e", label: "Edited & accepted" },
  changes_requested: { color: "#f59e0b", label: "Changes requested" },
  reassigned: { color: "#60a5fa", label: "Reassigned" },
  escalated: { color: "#f87171", label: "Escalated" },
  answered: { color: "#22c55e", label: "Answered" },
  snoozed: { color: "#a1a1aa", label: "Snoozed" },
  expired: { color: "#71717a", label: "Expired" },
}

const SNOOZE_CHOICES = [
  { label: "1 hour", ms: 60 * 60 * 1000 },
  { label: "24 hours", ms: 24 * 60 * 60 * 1000 },
  { label: "7 days", ms: 7 * 24 * 60 * 60 * 1000 },
]

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

export function DecisionCard({ item, onChanged }: { item: InboxCardItem; onChanged: () => Promise<void> | void }) {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [mode, setMode] = useState<"" | "changes" | "answer" | "reassign" | "escalate" | "snooze">("")
  const [text, setText] = useState("")
  const [snoozeMs, setSnoozeMs] = useState(SNOOZE_CHOICES[1].ms)

  const id = String(item.raw?.id ?? item.key.split(":")[1] ?? "")
  const status = item.status
  const actionable = status === "pending"
  const verdicts = item.raw?.verdicts ?? []
  const options = Array.isArray(item.raw?.options) ? item.raw.options : []

  async function send(verdict: string, extra: Record<string, unknown> = {}) {
    if (busy) return
    setBusy(verdict)
    setError(null)
    try {
      const res = await fetch(`/api/decisions/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          verdict,
          ...(item.artifactHash ? { artifactHash: item.artifactHash } : {}),
          ...extra,
        }),
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        setError(data.error ?? "Could not record the verdict.")
        return
      }
      setMode("")
      setText("")
      await onChanged()
    } catch {
      setError("Could not reach the server. Try again.")
    } finally {
      setBusy(null)
    }
  }

  function openMode(next: typeof mode) {
    setError(null)
    setMode((current) => (current === next ? "" : next))
    setText("")
  }

  const chip = STATUS_STYLE[status] ?? { color: "#a1a1aa", label: status }

  return (
    <li
      className="flex flex-col gap-3 rounded-[14px] p-4 sm:p-5"
      style={{ background: "var(--surface-1)", border: "1px solid var(--line-strong, var(--line))" }}
      data-testid="decision-card"
      data-decision-id={id}
    >
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span
            className="rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider"
            style={{ color: "#e7c979", background: "rgba(231,201,121,0.12)", border: "1px solid rgba(231,201,121,0.28)" }}
          >
            {KIND_LABEL[item.kind] ?? item.kind}
          </span>
          <span className="text-[12px] tabular-nums" style={{ color: "var(--ink-3)" }}>
            {relative(item.updatedAt)}
          </span>
        </div>
        <span className="text-[12px] font-medium" style={{ color: chip.color }} role="status">
          {chip.label}
        </span>
      </header>

      <div className="flex flex-col gap-1">
        <p className="text-[15px] font-medium leading-snug" style={{ color: "var(--ink)" }}>
          {item.title}
        </p>
        {item.summary ? (
          <p className="whitespace-pre-wrap text-[13px] leading-relaxed" style={{ color: "var(--ink-2)" }}>
            {item.summary}
          </p>
        ) : null}
      </div>

      {item.artifactRef || item.artifactHash ? (
        <dl
          className="grid grid-cols-1 gap-x-6 gap-y-1 rounded-[10px] p-3 text-[12px] sm:grid-cols-2"
          style={{ background: "var(--surface-0)", border: "1px solid var(--line)", color: "var(--ink-3)" }}
        >
          {item.artifactRef ? (
            <>
              <dt>Artifact</dt>
              <dd className="break-all font-mono" style={{ color: "var(--ink-2)" }}>{item.artifactRef}</dd>
            </>
          ) : null}
          {item.artifactHash ? (
            <>
              <dt>Artifact hash</dt>
              <dd className="break-all font-mono" style={{ color: "var(--ink-2)" }} title={item.artifactHash}>
                {item.artifactHash.slice(0, 16)}…
              </dd>
            </>
          ) : null}
        </dl>
      ) : null}

      {options.length > 0 && (
        <ul className="flex flex-col gap-1 text-[13px]" style={{ color: "var(--ink-2)" }}>
          {options.map((o) => (
            <li key={o.id} className="flex flex-col">
              <span className="font-medium">{o.label}</span>
              {o.description ? <span className="text-[12px]" style={{ color: "var(--ink-3)" }}>{o.description}</span> : null}
            </li>
          ))}
        </ul>
      )}

      {item.raw?.reason ? (
        <p className="text-[13px] italic" style={{ color: "var(--ink-3)" }}>
          Reason: {String(item.raw.reason)}
        </p>
      ) : null}

      {error ? (
        <p className="text-[13px]" style={{ color: "#f87171" }} role="alert">
          {error}
        </p>
      ) : null}

      {actionable && (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            {item.kind === "question" ? (
              <button
                type="button"
                onClick={() => openMode("answer")}
                disabled={busy !== null}
                className="min-h-[40px] rounded-[10px] px-4 text-[13px] font-medium disabled:opacity-50"
                style={{ background: "var(--ink)", color: "var(--surface-0)" }}
              >
                Answer
              </button>
            ) : (
              <button
                type="button"
                onClick={() => send("approve")}
                disabled={busy !== null}
                className="min-h-[40px] rounded-[10px] px-4 text-[13px] font-medium disabled:opacity-50"
                style={{ background: "var(--ink)", color: "var(--surface-0)" }}
              >
                {busy === "approve" ? "Approving…" : "Approve"}
              </button>
            )}
            <button
              type="button"
              onClick={() => openMode("changes")}
              disabled={busy !== null}
              className="min-h-[40px] rounded-[10px] px-4 text-[13px] font-medium disabled:opacity-50"
              style={{ background: "var(--surface-2)", color: "var(--ink)", border: "1px solid var(--line-strong, var(--line))" }}
            >
              Request changes
            </button>
            {item.kind !== "question" && (
              <button
                type="button"
                onClick={() => send("edit_accept", { note: text || undefined })}
                disabled={busy !== null}
                className="min-h-[40px] rounded-[10px] px-4 text-[13px] font-medium disabled:opacity-50"
                style={{ background: "var(--surface-2)", color: "var(--ink)", border: "1px solid var(--line-strong, var(--line))" }}
              >
                Edit &amp; accept
              </button>
            )}
            <button
              type="button"
              onClick={() => openMode("reassign")}
              disabled={busy !== null}
              className="min-h-[40px] rounded-[10px] px-4 text-[13px] font-medium disabled:opacity-50"
              style={{ background: "transparent", color: "var(--ink-2)", border: "1px solid var(--line-strong, var(--line))" }}
            >
              Reassign
            </button>
            <button
              type="button"
              onClick={() => openMode("escalate")}
              disabled={busy !== null}
              className="min-h-[40px] rounded-[10px] px-4 text-[13px] font-medium disabled:opacity-50"
              style={{ background: "transparent", color: "var(--ink-2)", border: "1px solid var(--line-strong, var(--line))" }}
            >
              Escalate
            </button>
            <button
              type="button"
              onClick={() => openMode("snooze")}
              disabled={busy !== null}
              className="min-h-[40px] rounded-[10px] px-4 text-[13px] font-medium disabled:opacity-50"
              style={{ background: "transparent", color: "var(--ink-2)", border: "1px solid var(--line-strong, var(--line))" }}
            >
              Snooze
            </button>
            <button
              type="button"
              onClick={() =>
                send("snooze", { snoozeUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() })
              }
              disabled={busy !== null}
              className="min-h-[40px] rounded-[10px] px-4 text-[13px] font-medium disabled:opacity-50"
              style={{ background: "transparent", color: "var(--ink-2)", border: "1px solid var(--line-strong, var(--line))" }}
            >
              Archive
            </button>
          </div>

          {mode === "changes" && (
            <div className="flex flex-col gap-2 rounded-[10px] p-3" style={{ background: "var(--surface-0)", border: "1px solid var(--line)" }}>
              <label htmlFor={`changes-${id}`} className="text-[12px]" style={{ color: "var(--ink-3)" }}>
                What should change? A reason is required.
              </label>
              <textarea
                id={`changes-${id}`}
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={3}
                className="w-full rounded-[8px] p-2 text-[13px]"
                style={{ background: "var(--surface-1)", color: "var(--ink)", border: "1px solid var(--line)" }}
              />
              <button
                type="button"
                onClick={() => send("request_changes", { reason: text })}
                disabled={busy !== null || text.trim().length === 0}
                className="min-h-[40px] rounded-[10px] px-4 text-[13px] font-medium disabled:opacity-50"
                style={{ background: "var(--surface-2)", color: "var(--ink)", border: "1px solid var(--line-strong, var(--line))" }}
              >
                Send request for changes
              </button>
            </div>
          )}

          {mode === "answer" && (
            <div className="flex flex-col gap-2 rounded-[10px] p-3" style={{ background: "var(--surface-0)", border: "1px solid var(--line)" }}>
              <label htmlFor={`answer-${id}`} className="text-[12px]" style={{ color: "var(--ink-3)" }}>
                Your answer (required).
              </label>
              <textarea
                id={`answer-${id}`}
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={3}
                className="w-full rounded-[8px] p-2 text-[13px]"
                style={{ background: "var(--surface-1)", color: "var(--ink)", border: "1px solid var(--line)" }}
              />
              <button
                type="button"
                onClick={() => send("answer", { note: text })}
                disabled={busy !== null || text.trim().length === 0}
                className="min-h-[40px] rounded-[10px] px-4 text-[13px] font-medium disabled:opacity-50"
                style={{ background: "var(--ink)", color: "var(--surface-0)" }}
              >
                Send answer
              </button>
            </div>
          )}

          {(mode === "reassign" || mode === "escalate") && (
            <div className="flex flex-col gap-2 rounded-[10px] p-3" style={{ background: "var(--surface-0)", border: "1px solid var(--line)" }}>
              <label htmlFor={`${mode}-${id}`} className="text-[12px]" style={{ color: "var(--ink-3)" }}>
                {mode === "reassign" ? "Who should take it? (optional note)" : "Why escalate? (optional note)"}
              </label>
              <input
                id={`${mode}-${id}`}
                value={text}
                onChange={(e) => setText(e.target.value)}
                className="w-full rounded-[8px] p-2 text-[13px]"
                style={{ background: "var(--surface-1)", color: "var(--ink)", border: "1px solid var(--line)" }}
              />
              <button
                type="button"
                onClick={() => send(mode, { note: text })}
                disabled={busy !== null}
                className="min-h-[40px] rounded-[10px] px-4 text-[13px] font-medium disabled:opacity-50"
                style={{ background: "var(--surface-2)", color: "var(--ink)", border: "1px solid var(--line-strong, var(--line))" }}
              >
                {mode === "reassign" ? "Reassign" : "Escalate"}
              </button>
            </div>
          )}

          {mode === "snooze" && (
            <div className="flex flex-wrap items-center gap-2 rounded-[10px] p-3" style={{ background: "var(--surface-0)", border: "1px solid var(--line)" }}>
              <select
                aria-label="Snooze for"
                value={snoozeMs}
                onChange={(e) => setSnoozeMs(Number(e.target.value))}
                className="rounded-[8px] px-2 py-1 text-[13px]"
                style={{ background: "var(--surface-1)", color: "var(--ink)", border: "1px solid var(--line)" }}
              >
                {SNOOZE_CHOICES.map((c) => (
                  <option key={c.ms} value={c.ms}>{c.label}</option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => send("snooze", { snoozeUntil: new Date(Date.now() + snoozeMs).toISOString() })}
                disabled={busy !== null}
                className="min-h-[40px] rounded-[10px] px-4 text-[13px] font-medium disabled:opacity-50"
                style={{ background: "var(--surface-2)", color: "var(--ink)", border: "1px solid var(--line-strong, var(--line))" }}
              >
                Snooze
              </button>
            </div>
          )}
        </div>
      )}

      {verdicts.length > 0 && (
        <details className="text-[12px]" style={{ color: "var(--ink-3)" }}>
          <summary className="cursor-pointer">Audit trail ({verdicts.length})</summary>
          <ol className="mt-2 flex flex-col gap-1.5">
            {verdicts.map((v) => (
              <li key={v.id} className="flex flex-col gap-0.5">
                <span style={{ color: "var(--ink-2)" }}>
                  {v.verdict} · {v.status} · {relative(v.createdAt)}
                </span>
                <span className="font-mono text-[11px]">artifact {v.artifactHash.slice(0, 12)}… · actor {v.actorId ? v.actorId.slice(0, 8) : "system"}</span>
                {v.reason ? <span className="italic">reason: {v.reason}</span> : null}
                {v.note ? <span>note: {v.note}</span> : null}
              </li>
            ))}
          </ol>
        </details>
      )}
    </li>
  )
}
