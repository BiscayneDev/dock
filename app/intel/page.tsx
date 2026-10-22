"use client"

import { useEffect, useState, useCallback } from "react"

interface ReportItem {
  title: string
  detail: string
  source: string
  signal: "high" | "medium" | "low"
  /** Set when the item came from a scheduled run's payload (has a schedule id). */
  scheduled?: boolean
}

interface ReportSection {
  topic: string
  headline: string
  items: ReportItem[]
}

interface TopPost {
  platform: "x" | "reddit"
  handle: string
  text: string
  engagement: string
}

interface ScoutReport {
  generatedAt: string | null
  period: string
  topics: string[]
  summary: string
  sections: ReportSection[]
  topPosts: TopPost[]
  stats: { xPosts: number; redditThreads: number; webPages: number }
  rawOutput?: string
}

interface StandupData {
  date: string
  entries: string[]
  filesRead: string[]
}

const SIGNAL_COLORS: Record<string, string> = {
  high: "#ef4444",
  medium: "#f59e0b",
  low: "#6ee7b7",
}

const SIGNAL_LABELS: Record<string, string> = {
  high: "high",
  medium: "med",
  low: "low",
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

function StandupCard({ data }: { data: StandupData | null }) {
  const [open, setOpen] = useState(false)

  if (!data) return null

  const hasEntries = data.entries.length > 0
  const isSeparator = (e: string) => e.startsWith("---") && e.endsWith("---")

  return (
    <section
      className="rounded-[15px] border"
      style={{ borderColor: "var(--line)", backgroundColor: "var(--surface-1)" }}
    >
      <button
        className="flex w-full items-center justify-between px-5 py-3.5 text-left transition-colors hover:bg-[var(--surface-2)]"
        onClick={() => setOpen((o) => !o)}
      >
        <div className="flex items-center gap-2.5 font-mono text-[9.5px] uppercase tracking-[0.16em]" style={{ color: "var(--ink-3)" }}>
          <span
            className="h-[5px] w-[5px] rounded-full"
            style={{ backgroundColor: "var(--gold)", boxShadow: "0 0 7px var(--gold)" }}
          />
          Daily Standup
          <span className="normal-case tracking-normal" style={{ color: "var(--ink-3)" }}>· from memory logs</span>
          {data.filesRead.length > 0 && (
            <span
              className="ml-1 rounded-full px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.08em]"
              style={{ color: "var(--gold)", backgroundColor: "rgba(231,201,121,.09)" }}
            >
              {data.filesRead.length} file{data.filesRead.length !== 1 ? "s" : ""}
            </span>
          )}
        </div>
        <span
          className="text-xs transition-transform duration-200"
          style={{
            color: "var(--ink-3)",
            transform: open ? "rotate(180deg)" : "rotate(0deg)",
            display: "inline-block",
          }}
        >
          ▾
        </span>
      </button>

      {open && (
        <div className="space-y-1 border-t px-5 pb-4 pt-3" style={{ borderColor: "var(--line)" }}>
          {!hasEntries ? (
            <p className="text-xs" style={{ color: "var(--ink-3)" }}>
              No daily notes found for today or yesterday in{" "}
              <code style={{ color: "var(--ink-2)" }}>~/clawd/memory/</code>
            </p>
          ) : (
            data.entries.map((entry, i) =>
              isSeparator(entry) ? (
                <p
                  key={i}
                  className="pb-1 pt-2 font-mono text-[10px] uppercase tracking-[0.12em]"
                  style={{ color: "var(--ink-3)" }}
                >
                  {entry.replace(/^--- /, "").replace(/ ---$/, "")}
                </p>
              ) : (
                <div key={i} className="flex items-start gap-2">
                  <span className="mt-0.5 shrink-0 text-xs" style={{ color: "var(--gold)" }}>·</span>
                  <p className="text-xs leading-relaxed" style={{ color: "var(--ink-2)" }}>{entry}</p>
                </div>
              )
            )
          )}
        </div>
      )}
    </section>
  )
}

export default function IntelPage() {
  const [report, setReport] = useState<ScoutReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [deploying, setDeploying] = useState(false)
  const [standup, setStandup] = useState<StandupData | null>(null)

  const fetchReport = useCallback(async () => {
    try {
      const res = await fetch("/api/intel/report", { cache: "no-store" })
      const data = await res.json()
      setReport(data)
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchReport()
    // Fetch standup data
    fetch("/api/standup")
      .then((r) => r.json())
      .then((d: StandupData) => setStandup(d))
      .catch(() => {})
  }, [fetchReport])

  const hasReport = report?.generatedAt != null && (report?.sections?.length ?? 0) > 0

  return (
    <div className="mx-auto max-w-[820px] space-y-6 px-5 pb-24 pt-2 lg:px-8">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2.5 font-mono text-[9.5px] uppercase tracking-[0.16em]" style={{ color: "var(--ink-3)" }}>
            <span
              className="h-[7px] w-[7px] rotate-45"
              style={{ background: "var(--gold)", boxShadow: "0 0 10px rgba(231,201,121,.6)" }}
            />
            Scout · Market Intelligence
            {report?.generatedAt && (
              <span>· {timeAgo(report.generatedAt)}</span>
            )}
          </div>
          <h1
            className="mt-3 font-serif text-[40px] font-normal leading-[1.1] tracking-[-0.01em]"
            style={{ color: "var(--ink)" }}
          >
            Intel
          </h1>
          <p className="mt-2 text-[14px]" style={{ color: "var(--ink-2)" }}>
            Scout&apos;s market intelligence feed
          </p>
        </div>

        <button
          onClick={async () => {
            setDeploying(true)
            await fetch("/api/intel/deploy", { method: "POST" }).catch(() => {})
            // Poll every 15s for up to 3 minutes
            let attempts = 0
            const poll = setInterval(async () => {
              attempts++
              await fetchReport()
              if (attempts >= 12) { clearInterval(poll); setDeploying(false) }
            }, 15000)
          }}
          disabled={deploying}
          className="rounded-[10px] px-4 py-2 font-mono text-[11px] uppercase tracking-[0.08em] transition-all duration-200 hover:-translate-y-[1px] disabled:opacity-50"
          style={{
            backgroundColor: "var(--gold)",
            color: "#1a1508",
            cursor: deploying ? "not-allowed" : "pointer",
          }}
        >
          <span style={{ display: "inline-block", animation: deploying ? "spin 1s linear infinite" : "none" }}>🔭</span>{" "}
          {deploying ? "Scout deployed..." : "Deploy Scout"}
        </button>
      </div>

      {loading ? (
        <div className="flex min-h-[40vh] items-center justify-center">
          <p className="text-[13px]" style={{ color: "var(--ink-3)" }}>Loading last report...</p>
        </div>
      ) : !hasReport ? (
        <div
          className="rounded-[15px] border p-12 text-center"
          style={{ borderColor: "var(--line)", background: "linear-gradient(180deg, var(--surface-1), #08080b)" }}
        >
          <p className="font-serif text-[34px]" style={{ color: "var(--ink-2)" }}>🔭</p>
          <p className="mt-3 text-[14px] font-semibold" style={{ color: "var(--ink)" }}>Scout hasn&apos;t reported yet</p>
          <p className="mt-1.5 text-[12.5px]" style={{ color: "var(--ink-3)" }}>
            Hit &quot;Deploy Scout&quot; or ask your chief of staff &quot;what&apos;s the latest in agent land&quot;
          </p>
        </div>
      ) : (
        <>
          {/* Executive summary */}
          <section
            className="rounded-[15px] border p-7 pb-6"
            style={{ borderColor: "var(--line)", background: "linear-gradient(180deg, var(--surface-1), #08080b)" }}
          >
            <div className="mb-3 flex items-center gap-2.5 font-mono text-[9.5px] uppercase tracking-[0.16em]" style={{ color: "var(--ink-3)" }}>
              <span
                className="h-[5px] w-[5px] rounded-full"
                style={{ backgroundColor: "var(--gold)", boxShadow: "0 0 7px var(--gold)" }}
              />
              Executive Summary
              <span
                className="rounded-full px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.08em]"
                style={{ color: "var(--gold)", backgroundColor: "rgba(231,201,121,.09)" }}
              >
                {report?.period ?? "24h"}
              </span>
            </div>
            <p className="max-w-[62ch] text-[15px] leading-[1.72]" style={{ color: "var(--ink-2)" }}>
              {report?.summary}
            </p>

            {report?.stats && (
              <div className="mt-5 flex items-baseline gap-7 border-t pt-4" style={{ borderColor: "var(--line)" }}>
                <div className="flex items-baseline gap-1.5">
                  <span className="font-serif text-[24px] tabular-nums" style={{ color: "var(--ink)" }}>{report.stats.xPosts}</span>
                  <span className="font-mono text-[9.5px] uppercase tracking-[0.1em]" style={{ color: "var(--ink-3)" }}>X posts</span>
                </div>
                <div className="flex items-baseline gap-1.5">
                  <span className="font-serif text-[24px] tabular-nums" style={{ color: "var(--ink)" }}>{report.stats.redditThreads}</span>
                  <span className="font-mono text-[9.5px] uppercase tracking-[0.1em]" style={{ color: "var(--ink-3)" }}>Reddit threads</span>
                </div>
                <div className="flex items-baseline gap-1.5">
                  <span className="font-serif text-[24px] tabular-nums" style={{ color: "var(--ink)" }}>{report.stats.webPages}</span>
                  <span className="font-mono text-[9.5px] uppercase tracking-[0.1em]" style={{ color: "var(--ink-3)" }}>Web pages</span>
                </div>
              </div>
            )}
          </section>

          {/* Sections */}
          <div className="space-y-4">
            {report?.sections?.map((section) => (
              <section
                key={section.topic}
                className="rounded-[15px] border p-6"
                style={{ borderColor: "var(--line)", backgroundColor: "var(--surface-1)" }}
              >
                <div className="font-mono text-[9.5px] uppercase tracking-[0.16em]" style={{ color: "var(--ink-3)" }}>
                  {section.topic}
                </div>
                <p className="mt-1.5 text-[14px] font-semibold tracking-[-0.003em]" style={{ color: "var(--ink)" }}>
                  {section.headline}
                </p>

                <div className="mt-4 space-y-3.5">
                  {section.items?.map((item, i) => (
                    <div key={i} className="flex gap-3">
                      <span
                        className="mt-[7px] h-[5px] w-[5px] shrink-0 rounded-full"
                        style={{ backgroundColor: SIGNAL_COLORS[item.signal] ?? "var(--ink-3)" }}
                      />
                      <div className="min-w-0 space-y-0.5">
                        <p className="text-[12.5px] font-semibold" style={{ color: "var(--ink)" }}>{item.title}</p>
                        <p className="text-[11.5px] leading-[1.5]" style={{ color: "var(--ink-2)" }}>{item.detail}</p>
                        <p className="font-mono text-[9.5px] uppercase tracking-[0.08em]" style={{ color: "var(--ink-3)" }}>
                          {item.signal ? SIGNAL_LABELS[item.signal] ?? item.signal : ""} · per {item.source}
                          {item.scheduled && (
                            <span
                              className="ml-2 rounded-full px-1.5 py-0.5"
                              style={{ color: "var(--gold)", backgroundColor: "rgba(231,201,121,.09)" }}
                            >
                              scheduled
                            </span>
                          )}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>

          {/* Raw output fallback when no structured sections */}
          {(!report?.sections || report.sections.length === 0) && report?.rawOutput && (
            <section
              className="rounded-[15px] border p-6"
              style={{ borderColor: "var(--line)", backgroundColor: "var(--surface-1)" }}
            >
              <p className="mb-3 font-mono text-[9.5px] uppercase tracking-[0.16em]" style={{ color: "var(--ink-3)" }}>
                Scout&apos;s raw output
              </p>
              <pre
                className="overflow-x-auto whitespace-pre-wrap text-xs leading-relaxed"
                style={{ color: "var(--ink-2)" }}
              >
                {report.rawOutput}
              </pre>
            </section>
          )}

          {/* Top posts */}
          {report?.topPosts && report.topPosts.length > 0 && (
            <div className="space-y-3">
              <p className="font-mono text-[9.5px] uppercase tracking-[0.16em]" style={{ color: "var(--ink-3)" }}>Top posts</p>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {report.topPosts.map((post, i) => (
                  <div
                    key={i}
                    className="space-y-1.5 rounded-[11px] border p-4"
                    style={{ borderColor: "var(--line)", backgroundColor: "var(--surface-1)" }}
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs">{post.platform === "x" ? "𝕏" : "🟠"}</span>
                      <span className="text-[11.5px] font-semibold" style={{ color: "var(--ink)" }}>{post.handle}</span>
                      {post.engagement && (
                        <span className="ml-auto font-mono text-[9.5px]" style={{ color: "var(--ink-3)" }}>{post.engagement}</span>
                      )}
                    </div>
                    <p className="line-clamp-2 text-[11.5px] leading-[1.5]" style={{ color: "var(--ink-2)" }}>{post.text}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* Standup Report — always shown below Scout section */}
      <StandupCard data={standup} />
    </div>
  )
}
