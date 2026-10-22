"use client"

import { useCallback, useEffect, useMemo, useState } from "react"

const PURPLE = "#7c3aed"

interface MemoryItem {
  id: string
  scope: "fact" | "project"
  type: string
  content: string
  projectId: string | null
  projectName: string | null
  createdAt: string
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ""
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

function Card({ item, onDelete, busy }: { item: MemoryItem; onDelete: (id: string) => void; busy: boolean }) {
  return (
    <li
      className="rounded-lg p-3 flex items-start gap-3"
      style={{ backgroundColor: "#0c0c14", border: "1px solid #1a1a2e" }}
    >
      <div className="flex-1 min-w-0">
        <p className="text-sm text-zinc-300 leading-relaxed break-words">{item.content}</p>
        <p className="text-[10px] text-zinc-600 font-mono mt-1">
          {item.type} · {formatDate(item.createdAt)}
        </p>
      </div>
      <button
        type="button"
        onClick={() => onDelete(item.id)}
        disabled={busy}
        className="shrink-0 text-xs px-2 py-1 rounded-md text-zinc-500 hover:text-red-300 hover:bg-red-500/10 disabled:opacity-40 transition-colors"
        aria-label="Delete this memory"
      >
        Delete
      </button>
    </li>
  )
}

export default function MemoryPage() {
  const [items, setItems] = useState<MemoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const res = await fetch("/api/memory", { cache: "no-store" })
      if (res.status === 401) {
        setError("Sign in to see your memory.")
        setItems([])
        return
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = (await res.json()) as { items: MemoryItem[] }
      setItems(data.items ?? [])
    } catch {
      setError("Memory could not be loaded.")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const remove = useCallback(async (id: string) => {
    if (!window.confirm("Delete this memory? The Chief will no longer use it.")) return
    setBusyId(id)
    try {
      const res = await fetch(`/api/memory?id=${encodeURIComponent(id)}`, { method: "DELETE" })
      if (!res.ok && res.status !== 404) throw new Error(`HTTP ${res.status}`)
      setItems((prev) => prev.filter((i) => i.id !== id))
    } catch {
      setError("That memory could not be deleted. Try again.")
    } finally {
      setBusyId(null)
    }
  }, [])

  const facts = useMemo(() => items.filter((i) => i.scope === "fact"), [items])
  const projectGroups = useMemo(() => {
    const groups = new Map<string, { name: string; items: MemoryItem[] }>()
    for (const item of items) {
      if (item.scope !== "project" || !item.projectId) continue
      const group = groups.get(item.projectId) ?? { name: item.projectName ?? "Untitled project", items: [] }
      group.items.push(item)
      groups.set(item.projectId, group)
    }
    return [...groups.entries()].map(([id, g]) => ({ id, ...g }))
  }, [items])

  return (
    <div className="max-w-3xl mx-auto w-full px-4 sm:px-0 pb-10">
      <div className="flex items-center gap-2 mb-5">
        <span className="text-xl">🧠</span>
        <div>
          <h1 className="text-2xl font-bold text-white leading-none">Memory</h1>
          <p className="text-xs text-zinc-500 mt-0.5">
            What the Chief remembers about you and your projects. Only you can see or delete it.
          </p>
        </div>
      </div>

      {error && (
        <div
          className="rounded-lg px-4 py-3 mb-4 text-xs text-zinc-300"
          style={{ backgroundColor: "#111118", border: `1px solid ${PURPLE}40` }}
          role="alert"
        >
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center min-h-[40vh]">
          <p className="text-zinc-600 text-sm">Loading memory…</p>
        </div>
      ) : items.length === 0 && !error ? (
        <div
          className="rounded-xl p-10 text-center space-y-3"
          style={{ backgroundColor: "#111118", border: "1px solid #1a1a2e" }}
        >
          <p className="text-3xl">🧠</p>
          <p className="text-zinc-400 font-medium">Nothing remembered yet</p>
          <p className="text-xs text-zinc-600">
            After chats, the Chief saves durable facts and project knowledge here.
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          <section className="rounded-xl p-4 space-y-3" style={{ backgroundColor: "#111118", border: `1px solid ${PURPLE}28` }}>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: PURPLE, boxShadow: `0 0 6px ${PURPLE}` }} />
              <h2 className="text-xs font-mono uppercase tracking-wider text-zinc-500">Durable facts</h2>
              <span className="text-[10px] text-zinc-700 font-mono">{facts.length}</span>
            </div>
            {facts.length === 0 ? (
              <p className="text-xs text-zinc-600">No facts saved yet.</p>
            ) : (
              <ul className="space-y-2">
                {facts.map((item) => (
                  <Card key={item.id} item={item} onDelete={remove} busy={busyId === item.id} />
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-xl p-4 space-y-4" style={{ backgroundColor: "#111118", border: `1px solid ${PURPLE}28` }}>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: PURPLE, boxShadow: `0 0 6px ${PURPLE}` }} />
              <h2 className="text-xs font-mono uppercase tracking-wider text-zinc-500">Project knowledge</h2>
            </div>
            {projectGroups.length === 0 ? (
              <p className="text-xs text-zinc-600">No project knowledge saved yet.</p>
            ) : (
              projectGroups.map((group) => (
                <div key={group.id} className="space-y-2">
                  <h3 className="text-sm font-semibold" style={{ color: "#c4b5fd" }}>
                    {group.name}
                  </h3>
                  <ul className="space-y-2">
                    {group.items.map((item) => (
                      <Card key={item.id} item={item} onDelete={remove} busy={busyId === item.id} />
                    ))}
                  </ul>
                </div>
              ))
            )}
          </section>
        </div>
      )}
    </div>
  )
}
