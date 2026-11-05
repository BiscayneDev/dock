"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import type { Repo } from "@/lib/projects-source"

const PINNED = ["shipyard", "mission-control", "superteam-miami", "arken"]

const FALLBACK_DESCRIPTIONS: Record<string, string> = {
  shipyard: "The flagship operating system — infrastructure, agents, and interfaces.",
  "mission-control": "Command center for fleet orchestration and live agent work.",
  "superteam-miami": "Community site and tooling for the Superteam Miami chapter.",
  arken: "Research and experimentation workspace for long-horizon agent runs.",
}

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  const hrs = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins}m ago`
  if (hrs < 24) return `${hrs}h ago`
  if (days < 30) return `${days}d ago`
  return `${Math.floor(days / 30)}mo ago`
}

function ciColor(run: Repo["latestRun"]): string {
  if (!run) return "#71717a"
  if (run.status === "in_progress" || run.status === "queued") return "#f59e0b"
  if (run.conclusion === "success") return "#22c55e"
  return "#ef4444"
}

function ciLabel(run: Repo["latestRun"]): string {
  if (!run) return "no CI"
  if (run.status === "in_progress" || run.status === "queued") return "running"
  if (run.conclusion === "success") return "passing"
  return "failing"
}

function RepoCard({ repo, isPinned }: { repo: Repo; isPinned: boolean }) {
  const prCount = repo.openPRs.length
  const run = repo.latestRun
  const hasCI = run !== null
  const isRunning = run?.status === "in_progress" || run?.status === "queued"

  return (
    <Link
      href={`/projects/${encodeURIComponent(repo.name)}`}
      className="group block rounded-[15px] border p-[18px] transition-all duration-300 hover:-translate-y-[2px]"
      style={{ borderColor: "var(--line)", backgroundColor: "var(--surface-1)" }}
    >
      <div className="mb-3.5 flex items-center gap-2.5">
        <span
          className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[10px] border font-serif text-[17px]"
          style={{ borderColor: "var(--line)", backgroundColor: "var(--surface-3)", color: "var(--ink-2)" }}
        >
          ◈
        </span>
        <span className="min-w-0">
          <span className="flex items-center gap-2">
            <span className="block truncate text-[14px] font-semibold">{repo.name}</span>
            {isPinned && (
              <span
                className="font-mono text-[9px] uppercase tracking-[0.12em]"
                style={{ color: "var(--gold)" }}
              >
                pinned
              </span>
            )}
          </span>
          <span className="mt-px block line-clamp-1 text-[11px]" style={{ color: "var(--ink-3)" }}>
            {repo.description ?? FALLBACK_DESCRIPTIONS[repo.name] ?? "—"}
          </span>
        </span>
      </div>

      <div className="flex items-baseline gap-2">
        <span
          className="font-serif text-[27px] tabular-nums"
          style={{ color: prCount > 0 ? "var(--gold)" : "var(--ink-3)" }}
        >
          {prCount}
        </span>
        <span className="font-mono text-[10.5px] uppercase tracking-[0.08em]" style={{ color: "var(--ink-3)" }}>
          open PR{prCount === 1 ? "" : "s"}
        </span>
        <span className="ml-auto flex items-center gap-1.5 font-mono text-[10px]" style={{ color: "var(--ink-3)" }}>
          {hasCI && (
            <>
              {isRunning ? (
                <span className="relative flex h-[5px] w-[5px]">
                  <span
                    className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75"
                    style={{ backgroundColor: ciColor(run) }}
                  />
                  <span
                    className="relative inline-flex h-[5px] w-[5px] rounded-full"
                    style={{ backgroundColor: ciColor(run) }}
                  />
                </span>
              ) : (
                <span
                  className="h-[5px] w-[5px] rounded-full"
                  style={{ backgroundColor: ciColor(run), boxShadow: `0 0 8px ${ciColor(run)}` }}
                />
              )}
              {ciLabel(run)}
            </>
          )}
          <span>· {relativeTime(repo.updatedAt)}</span>
        </span>
      </div>
    </Link>
  )
}

export default function ProjectsPage() {
  const [repos, setRepos] = useState<Repo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    async function fetchRepos() {
      try {
        const res = await fetch("/api/projects")
        if (!res.ok) {
          throw new Error(`Request failed: ${res.status}`)
        }

        const data = await res.json()
        if (Array.isArray(data)) {
          setRepos(data)
        } else {
          throw new Error("Invalid projects response")
        }
      } catch {
        setError(true)
      } finally {
        setLoading(false)
      }
    }
    fetchRepos()
  }, [])

  if (loading) {
    return (
      <div className="mx-auto max-w-[820px] px-5 pb-24 pt-2 lg:px-8">
        <h1
          className="mt-10 font-serif text-[40px] font-normal leading-[1.1] tracking-[-0.01em]"
          style={{ color: "var(--ink)" }}
        >
          Projects
        </h1>
        <div className="mt-8 flex flex-col gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="h-[92px] animate-pulse rounded-[15px] border"
              style={{ borderColor: "var(--line)", backgroundColor: "var(--surface-1)" }}
            />
          ))}
        </div>
      </div>
    )
  }

  const pinnedRepos = PINNED.map((name) => repos.find((r) => r.name === name)).filter(
    (r): r is Repo => r !== undefined
  )
  const otherRepos = repos.filter((r) => !PINNED.includes(r.name))
  const openPRTotal = repos.reduce((sum, r) => sum + r.openPRs.length, 0)

  return (
    <div className="mx-auto max-w-[820px] px-5 pb-24 pt-2 lg:px-8">
      <div className="flex items-center justify-between">
        <span
          className="inline-flex items-center gap-2 rounded-full border px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.08em]"
          style={{ borderColor: "var(--line)", backgroundColor: "var(--surface-1)", color: "var(--ink-2)" }}
        >
          <span className="h-[5px] w-[5px] rounded-full" style={{ backgroundColor: "#6ee7b7", boxShadow: "0 0 7px #6ee7b7" }} />
          {repos.length} repositories · {openPRTotal} open PRs
        </span>
        <a
          href="https://github.com/BiscayneDev"
          target="_blank"
          rel="noopener noreferrer"
          className="font-mono text-[10.5px] uppercase tracking-[0.1em] transition-colors"
          style={{ color: "var(--ink-3)" }}
        >
          BiscayneDev
        </a>
      </div>

      <h1
        className="mt-10 font-serif text-[40px] font-normal leading-[1.1] tracking-[-0.01em]"
        style={{ color: "var(--ink)" }}
      >
        Projects
      </h1>
      <p className="mt-2.5 text-[14px]" style={{ color: "var(--ink-2)" }}>
        The working set — <b style={{ color: "var(--ink)", fontWeight: 550 }}>{pinnedRepos.length} pinned</b> under
        active development, {otherRepos.length} more in the yard.
      </p>

      {error ? (
        <p className="mt-10 text-[13px]" style={{ color: "var(--ink-3)" }}>
          Could not load repositories right now. Please try again in a moment.
        </p>
      ) : (
        <>
          {/* Pinned */}
          {pinnedRepos.length > 0 && (
            <section className="mt-10">
              <div
                className="mb-4 flex items-center gap-2.5 font-mono text-[9.5px] uppercase tracking-[0.16em]"
                style={{ color: "var(--ink-3)" }}
              >
                <span
                  className="inline-block h-[7px] w-[7px] rotate-45"
                  style={{ background: "linear-gradient(135deg, #a78bfa, #22d3ee)", boxShadow: "0 0 10px rgba(139,92,246,.6)" }}
                />
                Pinned
              </div>
              <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
                {pinnedRepos.map((repo) => (
                  <RepoCard key={repo.name} repo={repo} isPinned={true} />
                ))}
              </div>
            </section>
          )}

          {/* Everything else */}
          {otherRepos.length > 0 && (
            <section className="mt-10">
              <div
                className="mb-4 flex items-center gap-2.5 font-mono text-[9.5px] uppercase tracking-[0.16em]"
                style={{ color: "var(--ink-3)" }}
              >
                <span
                  className="inline-block h-[7px] w-[7px] rotate-45"
                  style={{ background: "linear-gradient(135deg, #a78bfa, #22d3ee)", boxShadow: "0 0 10px rgba(139,92,246,.6)" }}
                />
                All Repositories
              </div>
              <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
                {otherRepos.map((repo) => (
                  <RepoCard key={repo.name} repo={repo} isPinned={false} />
                ))}
              </div>
            </section>
          )}

          {repos.length === 0 && (
            <p className="mt-10 text-[13px]" style={{ color: "var(--ink-3)" }}>
              No repositories found yet.
            </p>
          )}
        </>
      )}
    </div>
  )
}
