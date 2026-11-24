"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import type {
  CurateResponse,
  CuratorProposal,
  DocsResponse,
  ExportBundle,
  ExportResponse,
  FlagCounts,
  FlagsResponse,
  KnowledgeDocument,
  KnowledgeFlag,
  ProposalsResponse,
  StatusFilter,
  TypeFilter,
} from "./types"
import {
  badgeFor,
  countOf,
  DOC_STATUSES,
  errorMessage,
  freshnessBadge,
  isPending,
  relativeTime,
  trustBadge,
  typeBadge,
} from "./format"
import { Badge, GhostButton, GoldButton, SectionHeader } from "./badges"
import { DocViewer } from "./DocViewer"
import { FlagsQueue } from "./FlagsQueue"
import { ProposalQueue } from "./ProposalCard"

const TYPE_TABS: Array<{ id: TypeFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "skill", label: "Skills" },
  { id: "domain", label: "Domain" },
  { id: "data_access", label: "Data access" },
]

const STATUS_TABS: Array<{ id: StatusFilter; label: string }> = [
  { id: "all", label: "Any status" },
  { id: "active", label: "Active" },
  { id: "stale", label: "Stale" },
  { id: "superseded", label: "Superseded" },
]

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" })
  const data = (await res.json().catch(() => null)) as (T & { error?: string }) | null
  if (!res.ok) {
    throw new Error(data?.error ?? `Request failed (HTTP ${res.status}).`)
  }
  return data as T
}

export function KnowledgeClient() {
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all")
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all")
  const [searchInput, setSearchInput] = useState("")
  const [query, setQuery] = useState("")

  const [docs, setDocs] = useState<KnowledgeDocument[]>([])
  const [docsLoading, setDocsLoading] = useState(true)
  const [docsError, setDocsError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const [flags, setFlags] = useState<KnowledgeFlag[]>([])
  const [counts, setCounts] = useState<FlagCounts>({ missing: 0, wrong: 0, stale: 0 })
  const [flagsLoading, setFlagsLoading] = useState(true)
  const [flagsError, setFlagsError] = useState<string | null>(null)

  const [proposals, setProposals] = useState<CuratorProposal[]>([])
  const [proposalsLoading, setProposalsLoading] = useState(true)
  const [proposalsError, setProposalsError] = useState<string | null>(null)
  const [busyProposalId, setBusyProposalId] = useState<string | null>(null)
  const [errorsByProposal, setErrorsByProposal] = useState<Record<string, string>>({})
  const [showDecided, setShowDecided] = useState(false)

  const [curating, setCurating] = useState(false)
  const [curateNote, setCurateNote] = useState<string | null>(null)
  const [curateError, setCurateError] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)

  const loadDocs = useCallback(async () => {
    setDocsLoading(true)
    try {
      const params = new URLSearchParams()
      if (typeFilter !== "all") params.set("type", typeFilter)
      if (statusFilter !== "all") params.set("status", statusFilter)
      const trimmed = query.trim()
      if (trimmed) params.set("q", trimmed)
      const qs = params.toString()
      const data = await fetchJson<DocsResponse | KnowledgeDocument[]>(
        `/api/knowledge/docs${qs ? `?${qs}` : ""}`,
      )
      const payload = data as DocsResponse | KnowledgeDocument[] | null
      const list = Array.isArray(payload) ? payload : (payload as Partial<DocsResponse> | null)?.documents
      setDocs(Array.isArray(list) ? list : [])
      setDocsError(null)
    } catch (e) {
      setDocsError(errorMessage(e, "Could not load documents."))
    } finally {
      setDocsLoading(false)
    }
  }, [typeFilter, statusFilter, query])

  const loadFlags = useCallback(async () => {
    setFlagsLoading(true)
    try {
      const data = await fetchJson<FlagsResponse>("/api/knowledge/flags")
      setFlags(Array.isArray(data?.flags) ? data.flags : [])
      const raw = data?.counts ?? {}
      setCounts({
        missing: countOf(raw.missing),
        wrong: countOf(raw.wrong),
        stale: countOf(raw.stale),
      })
      setFlagsError(null)
    } catch (e) {
      setFlagsError(errorMessage(e, "Could not load flags."))
    } finally {
      setFlagsLoading(false)
    }
  }, [])

  const loadProposals = useCallback(async () => {
    setProposalsLoading(true)
    try {
      const data = await fetchJson<ProposalsResponse>("/api/knowledge/proposals")
      setProposals(Array.isArray(data?.proposals) ? data.proposals : [])
      setProposalsError(null)
    } catch (e) {
      setProposalsError(errorMessage(e, "Could not load proposals."))
    } finally {
      setProposalsLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadDocs()
  }, [loadDocs])

  useEffect(() => {
    void loadFlags()
  }, [loadFlags])

  useEffect(() => {
    void loadProposals()
  }, [loadProposals])

  useEffect(() => {
    if (docs.length === 0) {
      setSelectedId(null)
      return
    }
    setSelectedId((current) => {
      if (current && docs.some((doc) => doc.id === current)) return current
      return docs[0]?.id ?? null
    })
  }, [docs])

  const sortedProposals = useMemo(
    () =>
      [...proposals].sort((a, b) => {
        const aPending = isPending(a.status) ? 0 : 1
        const bPending = isPending(b.status) ? 0 : 1
        if (aPending !== bPending) return aPending - bPending
        return Date.parse(b.createdAt ?? "") - Date.parse(a.createdAt ?? "")
      }),
    [proposals],
  )

  const pendingCount = useMemo(
    () => sortedProposals.filter((proposal) => isPending(proposal.status)).length,
    [sortedProposals],
  )

  const selectedDoc = useMemo(
    () => docs.find((doc) => doc.id === selectedId) ?? null,
    [docs, selectedId],
  )

  const anyLoading = docsLoading || flagsLoading || proposalsLoading

  function setProposalError(id: string, message: string | null) {
    setErrorsByProposal((prev) => {
      const next = { ...prev }
      if (message) next[id] = message
      else delete next[id]
      return next
    })
  }

  async function refreshAll() {
    await Promise.allSettled([loadDocs(), loadFlags(), loadProposals()])
  }

  async function runCurator() {
    setCurating(true)
    setCurateNote(null)
    setCurateError(null)
    try {
      const res = await fetch("/api/knowledge/curate", { method: "POST", cache: "no-store" })
      const data = (await res.json().catch(() => null)) as (CurateResponse & { error?: string }) | null
      if (!res.ok) {
        throw new Error(data?.error ?? `Curator failed (HTTP ${res.status}).`)
      }
      const created = countOf(data?.created)
      const conflicts = countOf(data?.conflicts)
      const ignored = countOf(data?.ignored)
      setCurateNote(
        `Curator finished · ${created} created · ${conflicts} conflict${conflicts === 1 ? "" : "s"} · ${ignored} ignored.`,
      )
      await Promise.allSettled([loadDocs(), loadFlags(), loadProposals()])
    } catch (e) {
      setCurateError(errorMessage(e, "Could not run the curator."))
    } finally {
      setCurating(false)
    }
  }

  async function exportBundle() {
    setExporting(true)
    setExportError(null)
    try {
      const res = await fetch("/api/knowledge/export", { cache: "no-store" })
      const data = (await res.json().catch(() => null)) as (ExportResponse & { error?: string }) | null
      if (!res.ok) {
        throw new Error(data?.error ?? `Export failed (HTTP ${res.status}).`)
      }
      const bundle: ExportBundle = data?.bundle ?? (data as unknown as ExportBundle)
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement("a")
      anchor.href = url
      anchor.download = `dock-knowledge-bundle-${new Date().toISOString().slice(0, 10)}.json`
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)
    } catch (e) {
      setExportError(errorMessage(e, "Could not export the bundle."))
    } finally {
      setExporting(false)
    }
  }

  async function decide(proposal: CuratorProposal, action: "approve" | "reject", reason?: string) {
    setBusyProposalId(proposal.id)
    setProposalError(proposal.id, null)
    try {
      const res = await fetch(`/api/knowledge/proposals/${encodeURIComponent(proposal.id)}/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(reason ? { action, reason } : { action }),
      })
      const data = (await res.json().catch(() => null)) as {
        proposal?: CuratorProposal
        error?: string
      } | null
      if (!res.ok) {
        const message =
          data?.error ??
          (res.status === 409
            ? "This proposal is no longer pending — the list has been refreshed."
            : `Could not record the decision (HTTP ${res.status}).`)
        setProposalError(proposal.id, message)
        if (res.status === 409 || res.status === 410) {
          await loadProposals()
        }
        return
      }
      const updated = data?.proposal
      if (updated && updated.id) {
        setProposals((prev) => prev.map((item) => (item.id === updated.id ? updated : item)))
      } else {
        await loadProposals()
      }
    } catch (e) {
      setProposalError(proposal.id, errorMessage(e, "Could not reach the server."))
    } finally {
      setBusyProposalId(null)
    }
  }

  return (
    <div
      className="mx-auto flex w-full max-w-[1180px] flex-col gap-9 px-4 pb-24 pt-3 md:px-6"
      data-testid="knowledge-page"
    >
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="font-serif text-[34px] leading-none" style={{ color: "var(--ink)" }}>
              Knowledge
            </h1>
            <p className="mt-2 max-w-[70ch] text-[13.5px] leading-relaxed" style={{ color: "var(--ink-2)" }}>
              Skills, domain knowledge and data-access guidance — flagged by runs, curated into proposals, written
              only when you approve them.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <GhostButton onClick={() => void refreshAll()} disabled={anyLoading}>
              Refresh
            </GhostButton>
            <GhostButton onClick={() => void exportBundle()} disabled={exporting}>
              {exporting ? "Exporting…" : "Export bundle"}
            </GhostButton>
            <GoldButton onClick={() => void runCurator()} disabled={curating}>
              {curating ? "Curating…" : "Run curator"}
            </GoldButton>
          </div>
        </div>

        <div
          className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[10.5px] uppercase tracking-[0.1em]"
          style={{ color: "var(--ink-3)" }}
        >
          <span>{docs.length} documents</span>
          <span>{flags.length} flags</span>
          <span>{pendingCount} proposals pending</span>
          {curateNote ? <span style={{ color: "#4ade80" }}>{curateNote}</span> : null}
          {curateError ? (
            <span style={{ color: "#f87171" }} role="alert">
              {curateError}
            </span>
          ) : null}
          {exportError ? (
            <span style={{ color: "#f87171" }} role="alert">
              {exportError}
            </span>
          ) : null}
        </div>
      </header>

      <section className="flex flex-col gap-3">
        <SectionHeader label="Library" count={docs.length} />

        <div className="flex flex-wrap items-center gap-2">
          <div
            role="tablist"
            aria-label="Filter by knowledge type"
            className="flex flex-wrap gap-1 rounded-lg p-1"
            style={{ background: "var(--surface-1)", border: "1px solid var(--line)" }}
          >
            {TYPE_TABS.map((tab) => {
              const active = typeFilter === tab.id
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setTypeFilter(tab.id)}
                  className="rounded-md px-3 py-1.5 text-[12px] transition-colors"
                  style={{
                    background: active ? "var(--surface-3)" : "transparent",
                    color: active ? "var(--ink)" : "var(--ink-3)",
                  }}
                >
                  {tab.label}
                </button>
              )
            })}
          </div>

          <div
            role="tablist"
            aria-label="Filter by status"
            className="flex flex-wrap gap-1 rounded-lg p-1"
            style={{ background: "var(--surface-1)", border: "1px solid var(--line)" }}
          >
            {STATUS_TABS.map((tab) => {
              const active = statusFilter === tab.id
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setStatusFilter(tab.id)}
                  className="rounded-md px-3 py-1.5 text-[12px] transition-colors"
                  style={{
                    background: active ? "var(--surface-3)" : "transparent",
                    color: active ? "var(--ink)" : "var(--ink-3)",
                  }}
                >
                  {tab.label}
                </button>
              )
            })}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault()
              setQuery(searchInput.trim())
            }}
            className="ml-auto flex items-center gap-2"
          >
            <input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search title, description, tags…"
              aria-label="Search knowledge"
              className="min-h-[36px] rounded-[8px] px-3 text-[13px] lg:w-[220px]"
              style={{ background: "var(--surface-1)", color: "var(--ink)", border: "1px solid var(--line)" }}
            />
            <GhostButton type="submit">Search</GhostButton>
          </form>
        </div>

        {docsError ? (
          <p
            className="rounded-xl px-4 py-3 text-[13px]"
            style={{
              color: "#f87171",
              background: "rgba(248,113,113,0.08)",
              border: "1px solid rgba(248,113,113,0.25)",
            }}
            role="alert"
          >
            {docsError}
          </p>
        ) : null}

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-[340px_minmax(0,1fr)]">
          <div
            className="self-start overflow-hidden rounded-[14px]"
            style={{ background: "var(--surface-1)", border: "1px solid var(--line)" }}
            data-testid="document-list"
          >
            {docsLoading ? (
              <p className="px-4 py-6 text-[12.5px]" style={{ color: "var(--ink-3)" }} role="status">
                Loading documents…
              </p>
            ) : docs.length === 0 ? (
              <div className="px-5 py-8 text-center">
                <p className="text-[13px] font-medium" style={{ color: "var(--ink-2)" }}>
                  No documents in this view
                </p>
                <p className="mt-1 text-[12px] leading-relaxed" style={{ color: "var(--ink-3)" }}>
                  Switch the type tab, clear the search, or run the curator once knowledge starts landing.
                </p>
              </div>
            ) : (
              <ul className="flex max-h-[640px] flex-col overflow-y-auto">
                {docs.map((doc) => {
                  const selected = doc.id === selectedId
                  return (
                    <li key={doc.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedId(doc.id)}
                        className="flex w-full flex-col gap-1.5 border-b px-3.5 py-3 text-left transition-colors last:border-b-0"
                        style={{
                          borderColor: "var(--line)",
                          background: selected ? "var(--surface-2)" : "transparent",
                          borderLeft: selected ? "2px solid var(--gold)" : "2px solid transparent",
                        }}
                        aria-pressed={selected}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <Badge style={typeBadge(doc.type)} />
                          <span className="shrink-0 text-[10.5px] tabular-nums" style={{ color: "var(--ink-3)" }}>
                            {relativeTime(doc.updatedAt)}
                          </span>
                        </div>
                        <span className="text-[13px] font-medium leading-snug" style={{ color: "var(--ink)" }}>
                          {doc.title || "Untitled document"}
                        </span>
                        <div className="flex flex-wrap gap-1">
                          <Badge style={trustBadge(doc.trustTier)} />
                          <Badge style={freshnessBadge(doc)} />
                          {doc.status ? <Badge style={badgeFor(DOC_STATUSES, doc.status)} /> : null}
                        </div>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>

          <div
            className="self-start rounded-[14px] p-4 sm:p-5"
            style={{ background: "var(--surface-1)", border: "1px solid var(--line)" }}
            data-testid="document-viewer"
          >
            <DocViewer doc={selectedDoc} />
          </div>
        </div>
      </section>

      <FlagsQueue
        flags={flags}
        counts={counts}
        loading={flagsLoading}
        error={flagsError}
        onRetry={() => void loadFlags()}
      />

      <ProposalQueue
        proposals={sortedProposals}
        loading={proposalsLoading}
        error={proposalsError}
        busyId={busyProposalId}
        errorsById={errorsByProposal}
        showDecided={showDecided}
        onToggleDecided={() => setShowDecided((v) => !v)}
        onRetry={() => void loadProposals()}
        onDecide={(proposal, action, reason) => void decide(proposal, action, reason)}
      />
    </div>
  )
}
