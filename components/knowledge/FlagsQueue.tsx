"use client"

import type { FlagCounts, KnowledgeFlag } from "./types"
import { countOf, flagKindBadge, relativeTime } from "./format"
import { Badge, EmptyState, ErrorNote, GhostButton, LoadingPanel, SectionHeader } from "./badges"

interface FlagsQueueProps {
  flags: KnowledgeFlag[]
  counts: FlagCounts
  loading: boolean
  error: string | null
  onRetry: () => void
}

export function FlagsQueue({ flags, counts, loading, error, onRetry }: FlagsQueueProps) {
  const total = countOf(counts.missing) + countOf(counts.wrong) + countOf(counts.stale)
  return (
    <section className="flex flex-col gap-3">
      <SectionHeader
        label="Flags queue"
        count={flags.length}
        right={
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge style={{ color: "#f87171", label: `Missing ${countOf(counts.missing)}` }} />
            <Badge style={{ color: "#fbbf24", label: `Wrong ${countOf(counts.wrong)}` }} />
            <Badge style={{ color: "#c084fc", label: `Stale ${countOf(counts.stale)}` }} />
          </div>
        }
      />

      {error ? <ErrorNote message={error} /> : null}

      {loading ? (
        <LoadingPanel label="Loading flags…" />
      ) : flags.length === 0 ? (
        <EmptyState
          icon="⚑"
          title={total > 0 ? "All flags accounted for" : "No flags yet"}
          body="Runs call the flag tool when they hit missing, wrong or stale knowledge; the curator reads those flags and proposes edits here. Nothing has been raised yet."
        />
      ) : (
        <ul className="grid grid-cols-1 gap-2.5 lg:grid-cols-2">
          {flags.map((flag) => (
            <li
              key={flag.id}
              className="flex flex-col gap-1.5 rounded-[12px] p-3.5"
              style={{ background: "var(--surface-1)", border: "1px solid var(--line)" }}
            >
              <div className="flex flex-wrap items-center gap-2">
                <Badge style={flagKindBadge(flag.kind)} />
                {flag.ref ? (
                  <span className="break-all font-mono text-[12px]" style={{ color: "var(--ink)" }}>
                    {flag.ref}
                  </span>
                ) : null}
                <span className="ml-auto shrink-0 text-[11.5px] tabular-nums" style={{ color: "var(--ink-3)" }}>
                  {relativeTime(flag.createdAt)}
                </span>
              </div>
              {flag.suggestedFix ? (
                <p className="text-[12.5px] leading-relaxed" style={{ color: "var(--ink-2)" }}>
                  <span className="font-mono text-[9.5px] uppercase tracking-[0.12em]" style={{ color: "var(--gold)" }}>
                    Suggested fix ·{" "}
                  </span>
                  {flag.suggestedFix}
                </p>
              ) : null}
              {flag.evidence ? (
                <p className="text-[12px] leading-relaxed" style={{ color: "var(--ink-3)" }}>
                  {flag.evidence}
                </p>
              ) : null}
              {flag.runId ? (
                <p className="mt-0.5 font-mono text-[10.5px]" style={{ color: "var(--ink-3)" }}>
                  run {flag.runId}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {error && !loading ? (
        <div>
          <GhostButton onClick={onRetry}>Retry flags</GhostButton>
        </div>
      ) : null}
    </section>
  )
}
