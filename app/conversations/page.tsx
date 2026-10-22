"use client"

import Link from "next/link"
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { MessageSquarePlus, Search, Loader2, PlayCircle, CheckCircle2, AlertTriangle } from "lucide-react"
import { CHIEF_RUNTIME_KEY } from "@/lib/chief-key"

interface ConversationSummary {
  id: string
  title: string
  agent: string
  status: "active" | "completed" | "failed" | "paused"
  createdAt: string
  updatedAt: string
  lastMessageAt: string
  latestPreview: string
  project?: string
  taskId?: string
  messageCount: number
  runCount: number
}

interface ConversationMessage {
  id: string
  role: "user" | "assistant" | "agent"
  text: string
  agent: string
  timestamp: number
  runId?: string
}

interface ConversationRun {
  id: string
  conversationId: string
  agent: string
  runtime: string
  status: "running" | "completed" | "failed"
  startedAt: string
  completedAt?: string
  taskId?: string
  error?: string
}

interface ConversationEvent {
  id: string
  conversationId: string
  type: string
  timestamp: string
  agent?: string
  runId?: string
  summary: string
}

interface ConversationDetail extends ConversationSummary {
  messages: ConversationMessage[]
  runs: ConversationRun[]
  events: ConversationEvent[]
}

interface RunDetail {
  run: ConversationRun
  conversation: { id: string; title: string; agent: string; taskId?: string }
  events: ConversationEvent[]
  messages: ConversationMessage[]
}

const AGENT_META: Record<string, { emoji: string; color: string; label: string }> = {
  vic: { emoji: "🦞", color: "#7c3aed", label: "Vic" },
  scout: { emoji: "🔭", color: "#06b6d4", label: "Scout" },
  builder: { emoji: "⚡", color: "#10b981", label: "Builder" },
  baron: { emoji: "🏦", color: "#ec4899", label: "Baron" },
  "deal-flow": { emoji: "🤝", color: "#f59e0b", label: "Deal Flow" },
}

function relativeTime(value: string | number): string {
  const date = typeof value === "number" ? new Date(value) : new Date(value)
  const diff = Date.now() - date.getTime()
  const mins = Math.floor(diff / 60000)
  const hrs = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins}m ago`
  if (hrs < 24) return `${hrs}h ago`
  if (days < 7) return `${days}d ago`
  return date.toLocaleDateString()
}

function statusColor(status: ConversationSummary["status"] | ConversationRun["status"]): string {
  if (status === "active" || status === "running") return "#06b6d4"
  if (status === "completed") return "#22c55e"
  if (status === "failed") return "#ef4444"
  return "#71717a"
}

function ConversationsPageInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const requestedId = searchParams.get("id") ?? ""
  const [conversations, setConversations] = useState<ConversationSummary[]>([])
  const [selectedId, setSelectedId] = useState("")
  const [selectedRunId, setSelectedRunId] = useState<string>("")
  const [detail, setDetail] = useState<ConversationDetail | null>(null)
  const [runDetail, setRunDetail] = useState<RunDetail | null>(null)
  const [conversationSummary, setConversationSummary] = useState("")
  const [summaryLoading, setSummaryLoading] = useState(false)
  const [query, setQuery] = useState("")
  const [draft, setDraft] = useState("")
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState("")
  const selectedIdRef = useRef("")
  const detailRequestRef = useRef(0)
  const runRequestRef = useRef(0)
  const summaryRequestRef = useRef(0)

  useEffect(() => {
    selectedIdRef.current = selectedId
  }, [selectedId])

  const fetchList = useCallback(
    async (search?: string) => {
      const suffix = search?.trim() ? `?q=${encodeURIComponent(search.trim())}` : ""
      const res = await fetch(`/api/conversations${suffix}`, { cache: "no-store" })
      const data = (await res.json()) as ConversationSummary[]
      const list = Array.isArray(data) ? data : []
      setConversations(list)
      if (requestedId && list.some((conversation) => conversation.id === requestedId)) {
        setSelectedId(requestedId)
      } else if (!selectedId && list[0]) {
        setSelectedId(list[0].id)
      }
      return list
    },
    [requestedId, selectedId]
  )

  const fetchDetail = useCallback(async (id: string) => {
    const requestId = ++detailRequestRef.current
    const res = await fetch(`/api/conversations/${id}`, { cache: "no-store" })
    if (!res.ok) return null
    const data = (await res.json()) as ConversationDetail
    if (requestId !== detailRequestRef.current || selectedIdRef.current !== id) {
      return null
    }
    setDetail(data)
    return data
  }, [])

  const fetchRunDetail = useCallback(async (conversationId: string, runId: string) => {
    const requestId = ++runRequestRef.current
    const res = await fetch(`/api/runs/${conversationId}/${runId}`, { cache: "no-store" })
    if (!res.ok) return null
    const data = (await res.json()) as RunDetail
    if (
      requestId !== runRequestRef.current ||
      selectedIdRef.current !== conversationId ||
      data.conversation.id !== conversationId ||
      data.run.id !== runId
    ) {
      return null
    }
    setRunDetail(data)
    return data
  }, [])

  const fetchConversationSummary = useCallback(async (id: string) => {
    const requestId = ++summaryRequestRef.current
    setSummaryLoading(true)
    try {
      const res = await fetch(`/api/summaries/conversation/${id}`, { cache: "no-store" })
      if (requestId !== summaryRequestRef.current || selectedIdRef.current !== id) {
        return null
      }
      if (!res.ok) {
        setConversationSummary("")
        return null
      }
      const data = (await res.json()) as { summary?: string }
      if (requestId !== summaryRequestRef.current || selectedIdRef.current !== id) {
        return null
      }
      const summary = typeof data.summary === "string" ? data.summary : ""
      setConversationSummary(summary)
      return summary
    } finally {
      if (requestId === summaryRequestRef.current) {
        setSummaryLoading(false)
      }
    }
  }, [])

  useEffect(() => {
    fetchList()
      .catch(() => null)
      .finally(() => setLoading(false))
  }, [fetchList])

  useEffect(() => {
    detailRequestRef.current += 1
    runRequestRef.current += 1
    summaryRequestRef.current += 1
    setDetail(null)
    setConversationSummary("")
    setSelectedRunId("")
    setRunDetail(null)
    setSummaryLoading(false)

    if (!selectedId) {
      return
    }
    if (requestedId !== selectedId) {
      const next = new URLSearchParams(searchParams.toString())
      next.set("id", selectedId)
      router.replace(`/conversations?${next.toString()}`)
    }
    fetchDetail(selectedId).catch(() => null)
    fetchConversationSummary(selectedId).catch(() => null)
  }, [fetchConversationSummary, fetchDetail, requestedId, router, searchParams, selectedId])

  const selectedSummary = useMemo(
    () => conversations.find((conversation) => conversation.id === selectedId) ?? null,
    [conversations, selectedId]
  )

  async function createConversation() {
    setCreating(true)
    setCreateError("")
    try {
      const res = await fetch("/api/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "New conversation", agent: CHIEF_RUNTIME_KEY }),
      })

      if (!res.ok) {
        throw new Error(`Failed to create conversation (${res.status})`)
      }

      const created = (await res.json()) as ConversationDetail
      await fetchList(query)
      setSelectedId(created.id)
      setDetail(created)
    } catch {
      setCreateError("Could not create a conversation. Please try again.")
    } finally {
      setCreating(false)
    }
  }

  async function sendMessage() {
    if (!draft.trim() || !selectedId) return
    setSending(true)
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: draft.trim(),
          conversationId: selectedId,
          agent: detail?.agent ?? selectedSummary?.agent ?? CHIEF_RUNTIME_KEY,
        }),
      })
      if (res.ok) {
        setDraft("")
        await fetchList(query)
        await fetchDetail(selectedId)
      }
    } finally {
      setSending(false)
    }
  }

  async function handleSearch(value: string) {
    setQuery(value)
    const list = await fetchList(value)
    if (list.length === 0) {
      setSelectedId("")
      setSelectedRunId("")
      setDetail(null)
      setRunDetail(null)
      return
    }
    if (!list.some((item) => item.id === selectedId)) {
      setSelectedId(list[0].id)
    }
  }

  return (
    <div className="h-[calc(100vh-3rem)] grid grid-cols-1 gap-4 lg:grid-cols-[20rem_minmax(0,1fr)_20rem]">
      <section className="flex min-h-0 flex-col rounded-2xl border border-zinc-800 bg-[#111118]">
        <div className="space-y-3 border-b border-zinc-800 p-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-semibold text-white">Conversations</h1>
              <p className="mt-1 text-xs text-zinc-500">Unified inbox for agent conversations and runs</p>
            </div>
            <button
              onClick={createConversation}
              disabled={creating}
              className="rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 text-xs font-semibold text-cyan-300 disabled:opacity-50"
            >
              <span className="inline-flex items-center gap-1.5">
                {creating ? <Loader2 size={12} className="animate-spin" /> : <MessageSquarePlus size={12} />}
                New
              </span>
            </button>
          </div>
          <label className="flex items-center gap-2 rounded-xl border border-zinc-800 bg-[#0a0a0f] px-3 py-2 text-sm text-zinc-400">
            <Search size={14} />
            <input
              value={query}
              onChange={(e) => {
                void handleSearch(e.target.value)
              }}
              placeholder="Search conversations"
              className="w-full bg-transparent outline-none placeholder:text-zinc-600"
            />
          </label>
          {createError ? <p className="text-xs text-red-400">{createError}</p> : null}
        </div>
        <div className="min-h-0 space-y-2 overflow-y-auto p-2">
          {loading ? (
            <p className="px-3 py-4 text-sm text-zinc-500">Loading...</p>
          ) : (
            conversations.map((conversation) => {
              const agent = AGENT_META[conversation.agent] ?? {
                emoji: "🤖",
                color: "#71717a",
                label: conversation.agent,
              }
              const active = conversation.id === selectedId
              return (
                <button
                  key={conversation.id}
                  onClick={() => {
                    setSelectedId(conversation.id)
                    setDetail(null)
                    setConversationSummary("")
                    setSelectedRunId("")
                    setRunDetail(null)
                  }}
                  className="w-full rounded-xl border px-3 py-3 text-left transition-colors"
                  style={{
                    backgroundColor: active ? "rgba(34,211,238,0.08)" : "#0a0a0f",
                    borderColor: active ? "rgba(34,211,238,0.25)" : "#1f1f2f",
                  }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium text-white">{conversation.title}</p>
                      <p className="mt-1 text-xs text-zinc-500">
                        {agent.emoji} {agent.label} • {conversation.messageCount} msgs • {conversation.runCount} runs
                      </p>
                    </div>
                    <span className="mt-1 h-2.5 w-2.5 rounded-full" style={{ backgroundColor: statusColor(conversation.status) }} />
                  </div>
                  <p className="mt-2 line-clamp-2 text-xs text-zinc-400">{conversation.latestPreview || "No messages yet"}</p>
                  <p className="mt-2 text-[11px] text-zinc-600">Updated {relativeTime(conversation.updatedAt)}</p>
                </button>
              )
            })
          )}
        </div>
      </section>

      <section className="flex min-h-0 flex-col rounded-2xl border border-zinc-800 bg-[#111118]">
        <div className="border-b border-zinc-800 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-white">{detail?.title ?? selectedSummary?.title ?? "Select a conversation"}</h2>
              {detail && (
                <p className="mt-1 text-xs text-zinc-500">
                  {AGENT_META[detail.agent]?.emoji ?? "🤖"} {AGENT_META[detail.agent]?.label ?? detail.agent} • last active {relativeTime(detail.updatedAt)}
                </p>
              )}
            </div>
            {selectedId && (
              <Link
                href={`/chat?id=${encodeURIComponent(selectedId)}`}
                className="rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 text-xs font-semibold text-cyan-300 transition-colors hover:bg-cyan-500/15"
              >
                Open in Chat
              </Link>
            )}
          </div>
          {selectedId ? (
            <button
              onClick={() => {
                void fetchConversationSummary(selectedId)
              }}
              disabled={summaryLoading}
              className="mt-4 rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 text-xs font-semibold text-cyan-300 transition-colors hover:bg-cyan-500/15 disabled:opacity-50"
            >
              {summaryLoading ? "Loading summary..." : conversationSummary ? "Regenerate summary" : "Fetch summary"}
            </button>
          ) : null}
        </div>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
          {detail?.messages.length ? (
            detail.messages.map((message) => {
              const agent = AGENT_META[message.agent] ?? {
                emoji: "🤖",
                color: "#71717a",
                label: message.agent,
              }
              const isUser = message.role === "user"
              return (
                <div key={message.id} className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
                  <div
                    className="max-w-[85%] rounded-2xl border px-4 py-3"
                    style={{
                      backgroundColor: isUser ? `${agent.color}20` : "#0a0a0f",
                      borderColor: isUser ? `${agent.color}40` : "#1f1f2f",
                    }}
                  >
                    <p className="mb-1 text-[11px] uppercase tracking-wide" style={{ color: isUser ? agent.color : "#71717a" }}>
                      {isUser ? "You" : `${agent.emoji} ${agent.label}`}
                    </p>
                    <p className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-200">{message.text}</p>
                    <p className="mt-2 text-[11px] text-zinc-600">{relativeTime(message.timestamp)}</p>
                  </div>
                </div>
              )
            })
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-zinc-500">Start the conversation from here.</div>
          )}
        </div>
        <div className="border-t border-zinc-800 p-4">
          <div className="flex gap-3">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Send a message to this agent..."
              rows={3}
              className="min-h-[84px] flex-1 rounded-xl border border-zinc-800 bg-[#0a0a0f] px-3 py-2 text-sm text-zinc-200 outline-none placeholder:text-zinc-600"
            />
            <button
              onClick={sendMessage}
              disabled={sending || !draft.trim() || !selectedId}
              className="rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-4 text-sm font-semibold text-cyan-300 disabled:opacity-50"
            >
              {sending ? "Sending..." : "Send"}
            </button>
          </div>
        </div>
      </section>

      <section className="flex min-h-0 flex-col rounded-2xl border border-zinc-800 bg-[#111118]">
        <div className="border-b border-zinc-800 p-4">
          <h2 className="text-lg font-semibold text-white">Run trace</h2>
          <p className="mt-1 text-xs text-zinc-500">Recent runs and canonical events for this conversation</p>
        </div>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-widest text-zinc-600">Runs</h3>
            <div className="space-y-2">
              {detail?.runs.length ? (
                detail.runs
                  .slice()
                  .reverse()
                  .map((run) => (
                    <button
                      key={run.id}
                      onClick={() => {
                        const conversationId = selectedId
                        if (!conversationId) return
                        setSelectedRunId(run.id)
                        setRunDetail(null)
                        void fetchRunDetail(conversationId, run.id)
                      }}
                      className="w-full rounded-xl border bg-[#0a0a0f] px-3 py-3 text-left"
                      style={{
                        borderColor: run.id === selectedRunId ? "rgba(34,211,238,0.25)" : "#27272a",
                      }}
                    >
                      <div className="flex items-center gap-2 text-sm text-white">
                        {run.status === "running" ? (
                          <PlayCircle size={14} style={{ color: statusColor(run.status) }} />
                        ) : run.status === "completed" ? (
                          <CheckCircle2 size={14} style={{ color: statusColor(run.status) }} />
                        ) : (
                          <AlertTriangle size={14} style={{ color: statusColor(run.status) }} />
                        )}
                        <span>{AGENT_META[run.agent]?.label ?? run.agent}</span>
                      </div>
                      <p className="mt-1 text-xs text-zinc-500">{run.runtime} • started {relativeTime(run.startedAt)}</p>
                      {run.error && <p className="mt-2 text-xs text-red-400">{run.error}</p>}
                    </button>
                  ))
              ) : (
                <p className="text-sm text-zinc-500">No runs yet.</p>
              )}
            </div>
          </div>

          {runDetail && (
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-widest text-zinc-600">Selected Run</h3>
              <div className="space-y-2 rounded-xl border border-zinc-800 bg-[#0a0a0f] p-3">
                <p className="text-sm text-white">
                  {runDetail.run.runtime} • {runDetail.run.status}
                </p>
                <p className="text-xs text-zinc-500">Started {relativeTime(runDetail.run.startedAt)}</p>
                <div className="space-y-2">
                  {runDetail.events.length ? (
                    runDetail.events.map((event) => (
                      <div key={event.id} className="text-xs text-zinc-400">
                        {event.summary}
                      </div>
                    ))
                  ) : (
                    <p className="text-xs text-zinc-500">No run events yet.</p>
                  )}
                </div>
              </div>
            </div>
          )}

          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-widest text-zinc-600">Events</h3>
            <div className="space-y-2">
              {detail?.events.length ? (
                detail.events
                  .slice()
                  .reverse()
                  .slice(0, 20)
                  .map((event) => (
                    <div key={event.id} className="rounded-xl border border-zinc-800 bg-[#0a0a0f] px-3 py-3">
                      <p className="text-sm text-zinc-200">{event.summary}</p>
                      <p className="mt-1 text-[11px] text-zinc-600">
                        {event.type} • {relativeTime(event.timestamp)}
                      </p>
                    </div>
                  ))
              ) : (
                <p className="text-sm text-zinc-500">No events yet.</p>
              )}
            </div>
          </div>

          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-widest text-zinc-600">Summary</h3>
            {conversationSummary ? (
              <div className="rounded-xl border border-zinc-800 bg-[#0a0a0f] px-3 py-3">
                <p className="whitespace-pre-wrap text-sm text-zinc-300">{conversationSummary}</p>
              </div>
            ) : (
              <p className="text-sm text-zinc-500">{summaryLoading ? "Loading summary..." : "No summary yet."}</p>
            )}
          </div>
        </div>
      </section>
    </div>
  )
}

export default function ConversationsPage() {
  return (
    <Suspense fallback={<div className="flex h-screen items-center justify-center text-zinc-500">Loading…</div>}>
      <ConversationsPageInner />
    </Suspense>
  )
}
