"use client"

import { useEffect, useState, useCallback } from "react"
import Link from "next/link"

interface ActivityEntry {
  id: string
  taskId: string
  taskTitle: string
  agent: string
  action: "started" | "completed" | "reviewed"
  summary?: string
  timestamp: string
}

const AGENT_EMOJI: Record<string, string> = {
  scout: "🔭",
  "deal-flow": "🤝",
  builder: "⚡",
  baron: "🏦",
  unassigned: "⚪",
}

const ACTION_COLOR: Record<string, string> = {
  started: "#3178c6",
  reviewed: "#f59e0b",
  completed: "#22c55e",
}

const ACTION_LABEL: Record<string, string> = {
  started: "started",
  reviewed: "submitted for review",
  completed: "completed",
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  const hrs = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins}m ago`
  if (hrs < 24) return `${hrs}h ago`
  if (days < 7) return `${days}d ago`
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

function dayLabel(iso: string): string {
  const d = new Date(iso)
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)

  if (d.toDateString() === today.toDateString()) return "Today"
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday"
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

function dayKey(iso: string): string {
  return new Date(iso).toDateString()
}

export default function ActivityPage() {
  const [entries, setEntries] = useState<ActivityEntry[]>([])
  const [loading, setLoading] = useState(true)

  const fetchActivity = useCallback(async () => {
    try {
      const res = await fetch("/api/activity?canonical=1", { cache: "no-store" })
      if (res.ok) {
        const data = (await res.json()) as ActivityEntry[]
        setEntries(Array.isArray(data) ? data : [])
      }
    } catch {
      // silently fail — keep existing data
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchActivity()
    const interval = setInterval(fetchActivity, 20_000)
    return () => clearInterval(interval)
  }, [fetchActivity])

  const grouped: { day: string; label: string; entries: ActivityEntry[] }[] = []
  const seen = new Set<string>()
  for (const entry of entries) {
    const key = dayKey(entry.timestamp)
    if (!seen.has(key)) {
      seen.add(key)
      grouped.push({ day: key, label: dayLabel(entry.timestamp), entries: [] })
    }
    grouped[grouped.length - 1].entries.push(entry)
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-white">Activity</h1>
        <p className="text-sm text-zinc-500 mt-1">Canonical event timeline across task conversations</p>
      </div>

      {loading ? (
        <div
          className="rounded-xl p-8 text-center"
          style={{ backgroundColor: "#111118", border: "1px solid #1a1a2e" }}
        >
          <p className="text-sm text-zinc-600">Loading activity...</p>
        </div>
      ) : entries.length === 0 ? (
        <div
          className="rounded-xl p-12 text-center"
          style={{ backgroundColor: "#111118", border: "1px solid #1a1a2e" }}
        >
          <p className="text-2xl mb-3">📋</p>
          <p className="text-sm text-zinc-400 font-medium">No activity yet — start shipping!</p>
          <p className="text-xs text-zinc-600 mt-1">
            Task conversations emit started, review, and completed events here.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {grouped.map((group) => (
            <div key={group.day}>
              <div className="flex items-center gap-3 mb-4">
                <span className="text-xs font-mono uppercase tracking-widest text-zinc-600">
                  {group.label}
                </span>
                <div className="flex-1 h-px bg-zinc-800" />
              </div>

              <div className="space-y-1">
                {group.entries.map((entry, i) => {
                  const emoji = AGENT_EMOJI[entry.agent] ?? "🤖"
                  const color = ACTION_COLOR[entry.action] ?? "#7c3aed"
                  const label = ACTION_LABEL[entry.action] ?? entry.action
                  const isLast = i === group.entries.length - 1

                  return (
                    <div key={entry.id} className="flex gap-4">
                      <div className="flex flex-col items-center" style={{ width: "2.5rem", flexShrink: 0 }}>
                        <div
                          className="flex items-center justify-center rounded-full text-base"
                          style={{
                            width: "2rem",
                            height: "2rem",
                            backgroundColor: "#111118",
                            border: `1.5px solid ${color}55`,
                            flexShrink: 0,
                          }}
                        >
                          <span>{emoji}</span>
                        </div>
                        {!isLast && (
                          <div
                            className="flex-1 w-px my-1"
                            style={{ backgroundColor: "#1a1a2e" }}
                          />
                        )}
                      </div>

                      <div
                        className="flex-1 rounded-xl px-4 py-3 mb-2"
                        style={{ backgroundColor: "#111118", border: "1px solid #1a1a2e" }}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm text-zinc-300 leading-snug">
                            <span
                              className="font-semibold capitalize"
                              style={{ color }}
                            >
                              {entry.agent === "deal-flow" ? "Deal Flow" : entry.agent.charAt(0).toUpperCase() + entry.agent.slice(1)}
                            </span>{" "}
                            <span className="text-zinc-500">{label}</span>{" "}
                            <Link
                              href={entry.taskId ? `/conversations?id=task-${entry.taskId}` : "/conversations"}
                              className="font-medium text-white hover:underline underline-offset-2"
                            >
                              {entry.taskTitle}
                            </Link>
                          </p>
                          <span
                            className="text-[10px] shrink-0 mt-0.5"
                            style={{ color: "#52525b" }}
                          >
                            {relativeTime(entry.timestamp)}
                          </span>
                        </div>
                        {entry.summary && (
                          <p className="text-xs text-zinc-600 mt-1.5 leading-relaxed">
                            {entry.summary}
                          </p>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
