"use client"

import { useState } from "react"
import type { CuratorProposal } from "./types"
import {
  absoluteTime,
  asPlainRecord,
  conflictEntries,
  demotionCopy,
  fieldDiffRows,
  isPending,
  lineDiff,
  listOrEmpty,
  normalizeKey,
  proposalStatusBadge,
  relativeTime,
  truncateMiddle,
  typeBadge,
  valueToText,
} from "./format"
import { Badge, EmptyState, GhostButton, GoldButton, SectionHeader } from "./badges"
import { OkfBody } from "./OkfBody"

const KIND_STYLES: Record<string, { color: string; label: string }> = {
  create: { color: "#a78bfa", label: "Create" },
  patch: { color: "#60a5fa", label: "Patch" },
}

function FieldDiff({ before, after }: { before: unknown; after: unknown }) {
  const rows = fieldDiffRows(before, after)
  if (rows.length === 0) return null
  return (
    <div
      className="overflow-hidden rounded-[10px]"
      style={{ background: "var(--surface-0)", border: "1px solid var(--line)" }}
    >
      <div
        className="grid grid-cols-1 gap-1 px-3 py-1.5 font-mono text-[9px] uppercase tracking-[0.14em] sm:grid-cols-[150px_1fr_1fr]"
        style={{ color: "var(--ink-3)", borderBottom: "1px solid var(--line)" }}
      >
        <span>Field</span>
        <span>Before</span>
        <span>After</span>
      </div>
      {rows.map((row) => (
        <div
          key={row.field}
          className="grid grid-cols-1 gap-1 border-b px-3 py-1.5 last:border-b-0 sm:grid-cols-[150px_1fr_1fr]"
          style={{ borderColor: "var(--line)" }}
        >
          <span className="break-all font-mono text-[11px]" style={{ color: "var(--ink-3)" }}>
            {row.field}
          </span>
          <span
            className="whitespace-pre-wrap break-words font-mono text-[11.5px]"
            style={{ color: row.changed ? "#fca5a5" : "var(--ink-3)" }}
          >
            {row.before || "—"}
          </span>
          <span
            className="whitespace-pre-wrap break-words font-mono text-[11.5px]"
            style={{ color: row.changed ? "#86efac" : "var(--ink-2)" }}
          >
            {row.after || "—"}
          </span>
        </div>
      ))}
    </div>
  )
}

function TextDiff({ before, after }: { before: string; after: string }) {
  const rows = lineDiff(before, after)
  return (
    <div
      className="overflow-x-auto rounded-[10px] p-2 font-mono text-[11.5px] leading-[1.65]"
      style={{ background: "var(--surface-0)", border: "1px solid var(--line)" }}
    >
      {rows.map((row, i) => {
        const color =
          row.kind === "add" ? "#86efac" : row.kind === "del" ? "#fca5a5" : "var(--ink-3)"
        const bg =
          row.kind === "add"
            ? "rgba(74,222,128,0.07)"
            : row.kind === "del"
              ? "rgba(248,113,113,0.07)"
              : "transparent"
        const prefix = row.kind === "add" ? "+" : row.kind === "del" ? "-" : " "
        return (
          <div key={i} className="whitespace-pre-wrap" style={{ color, background: bg }}>
            <span style={{ opacity: 0.6 }}>{prefix}</span> {row.text || " "}
          </div>
        )
      })}
    </div>
  )
}

function CreatePreview({ proposal }: { proposal: CuratorProposal }) {
  const doc = proposal.document
  if (!doc) {
    return (
      <p className="text-[12.5px]" style={{ color: "var(--ink-3)" }}>
        This proposal creates a new document, but no preview payload was returned.
      </p>
    )
  }
  return (
    <div
      className="flex flex-col gap-2 rounded-[10px] p-3.5"
      style={{ background: "var(--surface-0)", border: "1px solid var(--line)" }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge style={typeBadge(doc.type)} />
        <span className="text-[13px] font-medium" style={{ color: "var(--ink)" }}>
          {doc.title || "Untitled document"}
        </span>
      </div>
      {doc.description ? (
        <p className="text-[12.5px] leading-relaxed" style={{ color: "var(--ink-2)" }}>
          {doc.description}
        </p>
      ) : null}
      <OkfBody source={doc.body} maxHeight={300} />
    </div>
  )
}

interface ProposalCardProps {
  proposal: CuratorProposal
  busy: boolean
  error: string | null
  onDecide: (proposal: CuratorProposal, action: "approve" | "reject", reason?: string) => void
}

export function ProposalCard({ proposal, busy, error, onDecide }: ProposalCardProps) {
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState("")

  const id = proposal.id
  const kindKey = normalizeKey(proposal.kind)
  const kindStyle = KIND_STYLES[kindKey] ?? { color: "#8b8fa3", label: proposal.kind || "Change" }
  const status = proposal.status ?? "pending"
  const pending = isPending(status)
  const demotion = demotionCopy(proposal.demotion)
  const conflicts = conflictEntries(proposal.conflicts)

  const beforeRecord = asPlainRecord(proposal.before)
  const afterRecord = asPlainRecord(proposal.after)
  const beforeText = valueToText(proposal.before)
  const afterText = valueToText(proposal.after)
  const changedFields = listOrEmpty(proposal.changedFields)
  const evidenceRefs = listOrEmpty(proposal.evidenceRefs)
  const flagIds = listOrEmpty(proposal.flagIds)

  const title =
    kindKey === "create"
      ? proposal.document?.title || "New document"
      : proposal.docPath || proposal.docId || "Existing document"

  function cancelReject() {
    setRejecting(false)
    setReason("")
  }

  return (
    <li
      className="flex flex-col gap-3 rounded-[14px] p-4 sm:p-5"
      style={{
        background: "var(--surface-1)",
        border: `1px solid ${pending ? "var(--line-strong, var(--line))" : "var(--line)"}`,
      }}
      data-testid="proposal-card"
      data-proposal-id={id}
    >
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge style={kindStyle} />
          <span className="text-[12px] tabular-nums" style={{ color: "var(--ink-3)" }}>
            {relativeTime(proposal.updatedAt ?? proposal.createdAt)}
          </span>
          {proposal.priority ? (
            <span
              className="rounded-full px-2 py-0.5 font-mono text-[9.5px] uppercase tracking-wider"
              style={{ color: "var(--ink-3)", background: "var(--surface-2)", border: "1px solid var(--line)" }}
            >
              {String(proposal.priority)} priority
            </span>
          ) : null}
        </div>
        <Badge style={proposalStatusBadge(status)} />
      </header>

      <div className="flex flex-col gap-1">
        <p className="text-[14.5px] font-medium leading-snug" style={{ color: "var(--ink)" }}>
          {title}
        </p>
        {kindKey === "patch" && proposal.section ? (
          <p className="font-mono text-[11px]" style={{ color: "var(--ink-3)" }}>
            section · {proposal.section}
          </p>
        ) : null}
        {proposal.rationale ? (
          <p className="whitespace-pre-wrap text-[13px] leading-relaxed" style={{ color: "var(--ink-2)" }}>
            {proposal.rationale}
          </p>
        ) : null}
      </div>

      {kindKey === "create" ? (
        <div className="flex flex-col gap-1.5">
          <p className="font-mono text-[9.5px] uppercase tracking-[0.16em]" style={{ color: "var(--ink-3)" }}>
            New document preview
          </p>
          <CreatePreview proposal={proposal} />
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          <p className="font-mono text-[9.5px] uppercase tracking-[0.16em]" style={{ color: "var(--ink-3)" }}>
            Proposed change
          </p>
          {beforeRecord || afterRecord ? (
            <FieldDiff before={proposal.before} after={proposal.after} />
          ) : beforeText || afterText ? (
            <TextDiff before={beforeText} after={afterText} />
          ) : changedFields.length > 0 ? (
            <div
              className="flex flex-wrap gap-1.5 rounded-[10px] p-3"
              style={{ background: "var(--surface-0)", border: "1px solid var(--line)" }}
            >
              {changedFields.map((field) => (
                <span
                  key={field}
                  className="rounded-full px-2 py-0.5 font-mono text-[10.5px]"
                  style={{ color: "#93c5fd", background: "rgba(96,165,250,0.1)", border: "1px solid rgba(96,165,250,0.3)" }}
                >
                  {field}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-[12.5px]" style={{ color: "var(--ink-3)" }}>
              No inline before/after payload was returned for this patch.
            </p>
          )}
        </div>
      )}

      {demotion ? (
        <div
          className="rounded-[10px] px-3 py-2.5 text-[12.5px] leading-relaxed"
          style={{
            background: "rgba(251,191,36,0.08)",
            border: "1px solid rgba(251,191,36,0.28)",
            color: "#fcd34d",
          }}
          role="alert"
        >
          <span className="mr-2 font-mono text-[9.5px] uppercase tracking-[0.12em]">⚠ Demotion</span>
          {demotion}
        </div>
      ) : null}

      {conflicts.length > 0 ? (
        <div
          className="rounded-[10px] px-3 py-2.5 text-[12.5px] leading-relaxed"
          style={{
            background: "rgba(248,113,113,0.08)",
            border: "1px solid rgba(248,113,113,0.28)",
            color: "#fca5a5",
          }}
          role="alert"
        >
          <span className="mr-2 font-mono text-[9.5px] uppercase tracking-[0.12em]">Conflict</span>
          {conflicts.map((entry, i) => (
            <span key={i} className="block">
              · {entry}
            </span>
          ))}
        </div>
      ) : null}

      {evidenceRefs.length > 0 || flagIds.length > 0 ? (
        <p className="font-mono text-[10.5px] leading-relaxed" style={{ color: "var(--ink-3)" }}>
          flags {flagIds.join(", ") || "—"}
          {evidenceRefs.length > 0 ? ` · evidence ${evidenceRefs.map((ref) => truncateMiddle(ref, 6)).join(", ")}` : ""}
        </p>
      ) : null}

      {!pending ? (
        <div className="flex flex-col gap-0.5 text-[12px]" style={{ color: "var(--ink-3)" }}>
          <span>
            {normalizeKey(status) === "rejected" ? "Rejected" : "Decided"} by{" "}
            {proposal.decisionBy || "unknown"} · {absoluteTime(proposal.decisionAt)}
          </span>
          {proposal.decisionReason ? (
            <span className="italic">reason: {proposal.decisionReason}</span>
          ) : null}
          {proposal.appliedDocId ? (
            <span className="font-mono text-[11px]">applied → doc {proposal.appliedDocId}</span>
          ) : null}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            <GoldButton onClick={() => onDecide(proposal, "approve")} disabled={busy}>
              {busy ? "Working…" : "Approve"}
            </GoldButton>
            <GhostButton onClick={() => setRejecting((v) => !v)} disabled={busy}>
              Reject…
            </GhostButton>
          </div>
          {rejecting ? (
            <div
              className="flex flex-col gap-2 rounded-[10px] p-3"
              style={{ background: "var(--surface-0)", border: "1px solid var(--line)" }}
            >
              <label
                htmlFor={`reject-${id}`}
                className="text-[12px]"
                style={{ color: "var(--ink-3)" }}
              >
                Why reject? A reason is required.
              </label>
              <textarea
                id={`reject-${id}`}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                className="w-full rounded-[8px] p-2 text-[13px]"
                style={{ background: "var(--surface-1)", color: "var(--ink)", border: "1px solid var(--line)" }}
              />
              <div className="flex flex-wrap gap-2">
                <GhostButton
                  onClick={() => onDecide(proposal, "reject", reason.trim())}
                  disabled={busy || reason.trim().length === 0}
                >
                  Send rejection
                </GhostButton>
                <GhostButton onClick={cancelReject} disabled={busy}>
                  Cancel
                </GhostButton>
              </div>
            </div>
          ) : null}
        </div>
      )}

      {error ? (
        <p className="text-[12.5px]" style={{ color: "#f87171" }} role="alert">
          {error}
        </p>
      ) : null}
    </li>
  )
}

interface ProposalQueueProps {
  proposals: CuratorProposal[]
  loading: boolean
  error: string | null
  busyId: string | null
  errorsById: Record<string, string>
  showDecided: boolean
  onToggleDecided: () => void
  onRetry: () => void
  onDecide: (proposal: CuratorProposal, action: "approve" | "reject", reason?: string) => void
}

export function ProposalQueue({
  proposals,
  loading,
  error,
  busyId,
  errorsById,
  showDecided,
  onToggleDecided,
  onRetry,
  onDecide,
}: ProposalQueueProps) {
  const pending = proposals.filter((p) => isPending(p.status))
  const decided = proposals.filter((p) => !isPending(p.status))

  return (
    <section className="flex flex-col gap-3">
      <SectionHeader
        label="Curator review"
        count={pending.length}
        right={
          decided.length > 0 ? (
            <GhostButton onClick={onToggleDecided}>
              {showDecided ? "Hide decided" : `Show decided (${decided.length})`}
            </GhostButton>
          ) : undefined
        }
      />

      {error ? <SectionError error={error} onRetry={onRetry} /> : null}

      {loading ? (
        <div
          className="flex items-center justify-center rounded-[15px] border px-6 py-10 text-[13px]"
          style={{ borderColor: "var(--line)", backgroundColor: "var(--surface-1)", color: "var(--ink-3)" }}
          role="status"
        >
          Loading proposals…
        </div>
      ) : proposals.length === 0 ? (
        <EmptyState
          icon="✎"
          title="No proposals yet"
          body="Run the curator to turn flags and run traces into proposed edits. Nothing is written until you approve it here."
        />
      ) : (
        <>
          <ul className="flex flex-col gap-3">
            {pending.map((proposal) => (
              <ProposalCard
                key={proposal.id}
                proposal={proposal}
                busy={busyId === proposal.id}
                error={errorsById[proposal.id] ?? null}
                onDecide={onDecide}
              />
            ))}
          </ul>
          {pending.length === 0 ? (
            <p className="text-[12.5px]" style={{ color: "var(--ink-3)" }}>
              The queue is clear — every proposal has a decision.
            </p>
          ) : null}
          {showDecided && decided.length > 0 ? (
            <ul className="flex flex-col gap-3 opacity-70">
              {decided.map((proposal) => (
                <ProposalCard
                  key={proposal.id}
                  proposal={proposal}
                  busy={false}
                  error={errorsById[proposal.id] ?? null}
                  onDecide={onDecide}
                />
              ))}
            </ul>
          ) : null}
        </>
      )}
    </section>
  )
}

function SectionError({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p
        className="rounded-xl px-4 py-3 text-[13px]"
        style={{
          color: "#f87171",
          background: "rgba(248,113,113,0.08)",
          border: "1px solid rgba(248,113,113,0.25)",
        }}
        role="alert"
      >
        {error}
      </p>
      <GhostButton onClick={onRetry}>Retry proposals</GhostButton>
    </div>
  )
}
