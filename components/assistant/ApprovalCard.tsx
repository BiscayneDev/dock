"use client"

import Link from "next/link"
import { useCallback, useEffect, useState } from "react"
import { ShieldCheck } from "lucide-react"
import { APPROVAL_CONFIRM_CENTS, formatCents, needsSecondClick, type ApprovalCardView } from "@/lib/approval-card"
import { previewReasonLabel } from "@/lib/preview-guard"

// Approval cards inline in the assistant thread. Data comes from GET /api/approvals (owner session).
// Polls every few seconds only while a pending approval is on screen.

const POLL_MS = 4000

export function ApprovalCards({ conversationId, refreshKey }: { conversationId: string; refreshKey?: number }) {
  const [cards, setCards] = useState<ApprovalCardView[]>([])

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/approvals?conversation=${encodeURIComponent(conversationId)}`, { cache: "no-store" })
      if (!res.ok) return
      const data = (await res.json()) as { cards?: ApprovalCardView[] }
      setCards(data.cards ?? [])
    } catch {
      // Keep the last good state. The next poll or refresh retries.
    }
  }, [conversationId])

  useEffect(() => {
    load().catch(() => null)
  }, [load, refreshKey])

  const hasPending = cards.some((c) => c.status === "pending")
  useEffect(() => {
    if (!hasPending) return
    const timer = window.setInterval(() => {
      load().catch(() => null)
    }, POLL_MS)
    return () => window.clearInterval(timer)
  }, [hasPending, load])

  if (cards.length === 0) return null
  return (
    <div className="flex flex-col gap-4" aria-label="Approvals">
      {cards.map((card) => (
        <ApprovalCard key={card.runId} card={card} onDecided={() => load().catch(() => null)} />
      ))}
    </div>
  )
}

function Field({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-[11px] uppercase tracking-[0.08em]" style={{ color: "var(--ink-3)" }}>
        {label}
      </dt>
      <dd
        className={`break-words text-[14px] leading-snug ${mono ? "font-mono text-[13px]" : ""}`}
        style={{ color: value === "unknown" ? "var(--ink-3)" : "var(--ink)" }}
      >
        {value}
      </dd>
    </div>
  )
}

export function ApprovalCard({ card, onDecided }: { card: ApprovalCardView; onDecided: () => void }) {
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState<null | "approve" | "reject">(null)
  const [error, setError] = useState<string | null>(null)
  const [previewBroken, setPreviewBroken] = useState(false)
  const [rejectOpen, setRejectOpen] = useState(false)
  const [reason, setReason] = useState("")
  const decidable = card.canDecide && card.status === "pending"

  async function decide(
    decision: "approve" | "reject",
    payload: { artifactHash?: string | null; reason?: string } = {},
  ) {
    if (busy) return
    setError(null)
    setBusy(decision)
    try {
      const res = await fetch(`/api/runs/${encodeURIComponent(card.runId)}/${decision}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(card.artifactHash ? { artifactHash: card.artifactHash } : {}),
          ...payload,
        }),
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        // already_decided and state_changed mean another click or tab got there first: show the current state.
        setError(res.status === 409 ? "This was already decided." : (data.error ?? "Could not record the decision."))
      }
    } catch {
      setError("Could not reach the server. Try again.")
    } finally {
      setBusy(null)
      setConfirming(false)
      setRejectOpen(false)
      setReason("")
      onDecided()
    }
  }

  function onApproveClick() {
    if (needsSecondClick(card, confirming)) {
      setConfirming(true)
      return
    }
    decide("approve").catch(() => null)
  }

  const statusColor =
    card.status === "approved" ? "#22c55e" : card.status === "rejected" ? "#f87171" : card.status === "pending" ? "#e7c979" : "var(--ink-3)"

  return (
    <section
      className="flex w-full flex-col gap-4 rounded-[14px] p-4 sm:p-5"
      style={{ background: "var(--surface-1)", border: "1px solid var(--line-strong, var(--line))", color: "var(--ink)" }}
      aria-label={`Approval: ${card.proposal}`}
    >
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-[13px] font-medium" style={{ color: "var(--ink-2)" }}>
          <ShieldCheck size={15} aria-hidden />
          Approval needed
        </div>
        <span className="text-[12px] font-medium" style={{ color: statusColor }} role="status">
          {card.statusLabel}
          {card.decidedAt ? ` · ${new Date(card.decidedAt).toLocaleString()}` : ""}
        </span>
      </header>

      <p className="text-[15px] leading-relaxed" style={{ color: "var(--ink)" }}>
        {card.proposal}
      </p>

      <div className="overflow-hidden rounded-[10px]" style={{ background: "var(--surface-0)", border: "1px solid var(--line)" }}>
        {card.screenshotUrl && !previewBroken ? (
          // Screenshot of the proposed page, captured before approval (lib/preview-capture.ts). It shows what
          // would happen; it does not approve anything. Source is a signed https URL or the owner's preview route.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={card.screenshotUrl}
            alt="Preview of the proposed work"
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() => setPreviewBroken(true)}
            className="block max-h-[260px] w-full object-cover"
          />
        ) : (
          <div
            className="flex h-[120px] items-center justify-center px-4 text-center text-[13px]"
            style={{ color: "var(--ink-3)" }}
            data-testid="no-preview"
          >
            {(() => {
              const reason = previewBroken ? "could not load" : previewReasonLabel(card.previewReason)
              return reason ? `No preview yet (${reason})` : "No preview yet"
            })()}
          </div>
        )}
      </div>

      <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
        <Field label="Target" value={card.target} mono />
        <Field label="Project" value={card.projectName} />
        {card.routeRows.map((row) => (
          <Field key={row.label} label={row.label} value={row.value} mono={row.mono} />
        ))}
        <Field label="Estimated cost" value={card.estimatedLabel} />
        <Field label="Run budget" value={card.budgetLabel} />
      </dl>

      {card.routeBasis && (
        <div className="flex flex-col gap-1 text-[12px]" style={{ color: "var(--ink-3)" }}>
          <p>{card.routeBasis}</p>
          {card.route?.estimateBasis && (
            <details>
              <summary className="cursor-pointer">Full estimate basis</summary>
              <p className="mt-1 break-words">{card.route.estimateBasis}</p>
            </details>
          )}
        </div>
      )}

      {error && (
        <p className="text-[13px]" style={{ color: "#f87171" }} role="alert">
          {error}
        </p>
      )}

      {decidable && (
        <div className="flex flex-col gap-2">
          {confirming && (
            <p className="text-[13px]" style={{ color: "#e7c979" }}>
              Estimated cost is {card.estimatedLabel}, above the {formatCents(APPROVAL_CONFIRM_CENTS)} confirmation limit. Approve {card.estimatedLabel} to{" "}
              {card.target}?
            </p>
          )}
          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              onClick={onApproveClick}
              disabled={busy !== null}
              className="min-h-[44px] rounded-[10px] px-4 text-[14px] font-medium disabled:opacity-50"
              style={{ background: "var(--ink)", color: "var(--surface-0)" }}
            >
              {busy === "approve" ? "Approving…" : confirming ? `Confirm approve ${card.estimatedLabel}` : "Approve"}
            </button>
            <button
              type="button"
              onClick={() => {
                if (confirming) {
                  setConfirming(false)
                  return
                }
                setRejectOpen((open) => !open)
              }}
              disabled={busy !== null}
              className="min-h-[44px] rounded-[10px] px-4 text-[14px] font-medium disabled:opacity-50"
              style={{ background: "var(--surface-2)", color: "var(--ink)", border: "1px solid var(--line-strong, var(--line))" }}
            >
              {busy === "reject" ? "Rejecting…" : confirming ? "Back" : "Request changes"}
            </button>
          </div>
        </div>
      )}

      {decidable && rejectOpen && (
        <div className="flex flex-col gap-2 rounded-[10px] p-3" style={{ background: "var(--surface-0)", border: "1px solid var(--line)" }}>
          <label htmlFor={`reason-${card.runId}`} className="text-[12px]" style={{ color: "var(--ink-3)" }}>
            What should change? A reason is required.
          </label>
          <textarea
            id={`reason-${card.runId}`}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            className="w-full rounded-[8px] p-2 text-[13px]"
            style={{ background: "var(--surface-1)", color: "var(--ink)", border: "1px solid var(--line)" }}
            placeholder="Describe the change you need"
          />
          <button
            type="button"
            onClick={() => decide("reject", { reason }).catch(() => null)}
            disabled={busy !== null || reason.trim().length === 0}
            className="min-h-[44px] rounded-[10px] px-4 text-[14px] font-medium disabled:opacity-50"
            style={{ background: "var(--surface-2)", color: "var(--ink)", border: "1px solid var(--line-strong, var(--line))" }}
          >
            {busy === "reject" ? "Sending…" : "Send request for changes"}
          </button>
        </div>
      )}

      <footer className="flex flex-wrap items-center justify-between gap-2 text-[12px]" style={{ color: "var(--ink-3)" }}>
        <span>{card.footer}</span>
        {card.decisionId && (
          <Link href="/inbox" className="tabular-nums hover:underline">
            Ledger decision {card.decisionId.slice(0, 8)}… · artifact {card.artifactHash ? card.artifactHash.slice(0, 12) : "unknown"}
          </Link>
        )}
      </footer>
    </section>
  )
}
