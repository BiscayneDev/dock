"use client"

import type { ReactNode } from "react"

import type { KnowledgeDocument } from "./types"
import {
  absoluteTime,
  badgeFor,
  DOC_STATUSES,
  freshnessBadge,
  listOrEmpty,
  relativeTime,
  truncateMiddle,
  trustBadge,
  typeBadge,
} from "./format"
import { Badge, EmptyState } from "./badges"
import { OkfBody } from "./OkfBody"

function MetaItem({ label, value, mono = false }: { label: string; value: ReactNode; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="font-mono text-[9px] uppercase tracking-[0.14em]" style={{ color: "var(--ink-3)" }}>
        {label}
      </dt>
      <dd
        className="mt-0.5 truncate text-[12.5px]"
        style={{ color: "var(--ink-2)", fontFamily: mono ? "var(--font-mono)" : undefined }}
        title={typeof value === "string" ? value : undefined}
      >
        {value}
      </dd>
    </div>
  )
}

export function DocViewer({ doc }: { doc: KnowledgeDocument | null }) {
  if (!doc) {
    return (
      <EmptyState
        icon="◈"
        title="Select a document"
        body="Pick any document from the library to read its metadata, provenance and OKF markdown body."
      />
    )
  }

  const id = doc.docId ?? doc.id
  const sources = listOrEmpty(doc.sources)
  const tags = listOrEmpty(doc.tags)

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge style={typeBadge(doc.type)} />
          <Badge style={badgeFor(DOC_STATUSES, doc.status)} />
          <Badge style={trustBadge(doc.trustTier)} />
          <Badge style={freshnessBadge(doc)} />
          <span className="text-[12px] tabular-nums" style={{ color: "var(--ink-3)" }}>
            updated {relativeTime(doc.updatedAt)}
          </span>
        </div>
        <h2 className="font-serif text-[22px] leading-tight" style={{ color: "var(--ink)" }}>
          {doc.title || "Untitled document"}
        </h2>
        {doc.description ? (
          <p className="text-[13px] leading-relaxed" style={{ color: "var(--ink-2)" }}>
            {doc.description}
          </p>
        ) : null}
        {doc.supersededBy ? (
          <p className="text-[12px]" style={{ color: "#a78bfa" }}>
            Superseded by <span className="font-mono">{doc.supersededBy}</span>
          </p>
        ) : null}
      </header>

      <dl
        className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-[10px] p-4 sm:grid-cols-3"
        style={{ background: "var(--surface-0)", border: "1px solid var(--line)" }}
      >
        <MetaItem label="Document ID" value={id} mono />
        <MetaItem label="Type" value={typeBadge(doc.type).label} />
        <MetaItem label="Status" value={badgeFor(DOC_STATUSES, doc.status).label} />
        <MetaItem label="Trust tier" value={trustBadge(doc.trustTier).label} />
        <MetaItem label="Freshness" value={freshnessBadge(doc).label} />
        <MetaItem label="Stale after" value={absoluteTime(doc.staleAfter)} />
        <MetaItem label="Content hash" value={truncateMiddle(doc.contentHash, 6)} mono />
        <MetaItem label="Updated" value={absoluteTime(doc.updatedAt)} />
      </dl>

      <section className="flex flex-col gap-2">
        <h3 className="font-mono text-[9.5px] uppercase tracking-[0.16em]" style={{ color: "var(--ink-3)" }}>
          Provenance · {sources.length}
        </h3>
        {sources.length === 0 ? (
          <p className="text-[12.5px]" style={{ color: "var(--ink-3)" }}>
            No sources recorded yet. Sources are attached as runs flag drift and the curator proposes edits.
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {sources.map((source, i) => (
              <li
                key={`${source}-${i}`}
                className="flex items-baseline gap-2 rounded-[8px] px-2 py-1 text-[12.5px]"
                style={{ background: "var(--surface-0)", border: "1px solid var(--line)" }}
              >
                <span className="shrink-0 font-mono text-[10px]" style={{ color: "var(--ink-3)" }}>
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="break-all font-mono text-[12px]" style={{ color: "var(--ink-2)" }}>
                  {source}
                </span>
              </li>
            ))}
          </ul>
        )}
        {tags.length > 0 ? (
          <p className="mt-1 font-mono text-[11px] tracking-[0.04em]" style={{ color: "var(--ink-3)" }}>
            {tags.map((tag) => `#${tag}`).join("  ")}
          </p>
        ) : null}
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="font-mono text-[9.5px] uppercase tracking-[0.16em]" style={{ color: "var(--ink-3)" }}>
          Body · OKF markdown
        </h3>
        <div
          className="rounded-[12px] px-4 py-4"
          style={{ background: "var(--surface-0)", border: "1px solid var(--line)" }}
        >
          <OkfBody source={doc.body} maxHeight={560} />
        </div>
      </section>
    </div>
  )
}
