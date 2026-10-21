"use client"

import { Suspense, useCallback, useEffect, useMemo, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Plus } from "lucide-react"
import { ChatThread } from "@/components/assistant/ChatThread"
import { Composer } from "@/components/assistant/Composer"
import {
  AGENTS,
  greetingFor,
  relativeTime,
  toInitialMessages,
  type AgentDef,
  type ConversationDetail,
  type ConversationSummary,
} from "@/components/assistant/shared"

interface AgentRecord {
  id: string
  name: string
  emoji: string
  role: string
  accent: string
  description: string
  tags?: string[]
}

interface IntegrationStatus {
  id: string
  name: string
  connected: boolean
  error?: string
}

const SUGGESTIONS = [
  "What needs me today?",
  "Brief a new task",
  "Summarize what the agents did",
  "How much have we spent this week?",
  "Review open decisions",
  "What are the agents doing?",
]

function useAgents(): { agents: AgentDef[]; roster: AgentRecord[] } {
  const [roster, setRoster] = useState<AgentRecord[]>([])
  useEffect(() => {
    let cancelled = false
    fetch("/api/agents", { cache: "no-store" })
      .then((r) => r.json())
      .then((data: AgentRecord[]) => {
        if (!cancelled && Array.isArray(data)) setRoster(data)
      })
      .catch(() => null)
    return () => {
      cancelled = true
    }
  }, [])
  const agents = useMemo<AgentDef[]>(
    () =>
      roster.length
        ? roster.map((a) => ({ id: a.id, name: a.name, emoji: a.emoji, accent: a.accent, description: a.role }))
        : AGENTS,
    [roster],
  )
  return { agents, roster }
}

function HomeView({ agents }: { agents: AgentDef[] }) {
  const router = useRouter()
  const [userName, setUserName] = useState("")
  const [integrations, setIntegrations] = useState<IntegrationStatus[]>([])
  const [recent, setRecent] = useState<ConversationSummary[]>([])
  const [agent, setAgent] = useState<AgentDef>(agents[0] ?? AGENTS[0])
  const [text, setText] = useState("")
  const [sending, setSending] = useState(false)

  useEffect(() => {
    fetch("/api/setup/status", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { userName?: string }) => d.userName && setUserName(d.userName))
      .catch(() => null)
    fetch("/api/settings/status", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: IntegrationStatus[]) => setIntegrations(Array.isArray(d) ? d : []))
      .catch(() => null)
    fetch("/api/conversations", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: ConversationSummary[]) => setRecent(Array.isArray(d) ? d.slice(0, 4) : []))
      .catch(() => null)
  }, [])

  const selected = agents.find((a) => a.id === agent.id) ?? agents[0] ?? AGENTS[0]
  const connectedCount = integrations.filter((i) => i.connected).length

  const start = useCallback(
    async (message: string) => {
      const trimmed = message.trim()
      if (!trimmed || sending) return
      setSending(true)
      try {
        const res = await fetch("/api/conversations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: trimmed.slice(0, 60), agent: selected.id }),
        })
        if (!res.ok) throw new Error("create failed")
        const conversation = (await res.json()) as { id: string }
        router.push(`/assistant?id=${encodeURIComponent(conversation.id)}&q=${encodeURIComponent(trimmed)}`)
      } catch {
        setSending(false)
      }
    },
    [router, selected.id, sending],
  )

  return (
    <div className="flex h-full flex-col items-center justify-center px-6">
      <div className="flex w-full max-w-[672px] flex-col items-center">
        <h1 className="text-center text-[34px] font-semibold tracking-[-0.02em] text-[#111]">
          {greetingFor(userName)}!
        </h1>
        <p className="mt-1 text-center text-[34px] font-semibold tracking-[-0.02em] text-[#a3a3a3]">
          What&apos;s next on your list?
        </p>

        <div className="mt-10 w-full">
          <Composer
            value={text}
            onChange={setText}
            onSubmit={() => start(text)}
            placeholder="Ask anything, or hand a task to an agent…"
            agents={agents}
            agent={selected}
            onAgentChange={setAgent}
            busy={sending}
            tray={
              <>
                <span>
                  {connectedCount > 0 ? `${connectedCount} of ${integrations.length} apps connected` : "No apps connected"}
                </span>
                <span className="text-[#525252]">Connected apps</span>
              </>
            }
          />
        </div>

        <div className="mt-5 flex flex-wrap justify-center gap-2">
          {SUGGESTIONS.slice(0, 4).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => start(s)}
              className="rounded-full bg-[#f4f4f4] px-4 py-2 text-[13px] text-[#404040] hover:bg-[#ebebeb]"
            >
              {s}
            </button>
          ))}
        </div>

        {recent.length > 0 && (
          <div className="mt-12 w-full">
            <p className="text-[12px] font-medium uppercase tracking-wide text-[#a3a3a3]">Recent</p>
            <div className="mt-2 divide-y divide-[#f0f0f0]">
              {recent.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => router.push(`/assistant?id=${encodeURIComponent(c.id)}`)}
                  className="flex w-full items-center justify-between gap-4 py-3 text-left"
                >
                  <span className="truncate text-[14px] text-[#262626]">{c.title}</span>
                  <span className="shrink-0 text-[12px] text-[#a3a3a3]">
                    {c.agent} · {relativeTime(c.updatedAt)}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function ThreadView({
  agents,
  roster,
  conversationId,
}: {
  agents: AgentDef[]
  roster: AgentRecord[]
  conversationId: string
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const pendingQuery = searchParams.get("q")
  const [pending, setPending] = useState<string | null>(pendingQuery)
  const [conversations, setConversations] = useState<ConversationSummary[]>([])
  const [detail, setDetail] = useState<ConversationDetail | null>(null)
  const [agent, setAgent] = useState<AgentDef>(agents[0] ?? AGENTS[0])

  const fetchConversations = useCallback(async () => {
    const res = await fetch("/api/conversations", { cache: "no-store" })
    const data = (await res.json()) as ConversationSummary[]
    setConversations(Array.isArray(data) ? data : [])
  }, [])

  const fetchDetail = useCallback(
    async (id: string) => {
      const res = await fetch(`/api/conversations/${id}`, { cache: "no-store" })
      if (!res.ok) return
      const data = (await res.json()) as ConversationDetail
      setDetail(data)
      const match = agents.find((a) => a.id === data.agent)
      if (match) setAgent(match)
    },
    [agents],
  )

  useEffect(() => {
    fetchConversations().catch(() => null)
  }, [fetchConversations])

  useEffect(() => {
    fetchDetail(conversationId).catch(() => null)
  }, [conversationId, fetchDetail])

  useEffect(() => {
    if (pendingQuery) {
      const next = new URLSearchParams(searchParams.toString())
      next.delete("q")
      router.replace(`/assistant?${next.toString()}`)
    }
  }, [pendingQuery, router, searchParams])

  const initialMessages = useMemo(() => toInitialMessages(detail), [detail])

  return (
    <div className="flex h-full min-h-0">
      {/* Conversations */}
      <aside className="hidden w-60 shrink-0 flex-col border-r border-[#f0f0f0] p-3 md:flex">
        <button
          type="button"
          onClick={() => router.push("/assistant")}
          className="mb-3 flex items-center gap-2 rounded-[10px] px-3 py-2 text-[13px] text-[#404040] hover:bg-[#f5f5f5]"
        >
          <Plus size={14} /> New chat
        </button>
        <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto">
          {conversations.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => router.push(`/assistant?id=${encodeURIComponent(c.id)}`)}
              className="w-full rounded-[10px] px-3 py-2 text-left"
              style={{ background: c.id === conversationId ? "#f0f0f0" : "transparent" }}
            >
              <p className="truncate text-[13px] text-[#262626]">{c.title}</p>
              <p className="text-[11px] text-[#a3a3a3]">
                {c.agent} · {relativeTime(c.updatedAt)}
              </p>
            </button>
          ))}
        </div>
      </aside>

      {/* Chat */}
      <section className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex items-center justify-between px-6 py-3">
          <h1 className="truncate text-[14px] font-medium text-[#111]">{detail?.title ?? "New chat"}</h1>
          <button
            type="button"
            onClick={() => fetchDetail(conversationId).catch(() => null)}
            className="rounded-full px-3 py-1.5 text-[12px] text-[#737373] hover:bg-[#f5f5f5]"
          >
            Refresh
          </button>
        </div>
        <ChatThread
          key={`${conversationId}-${agent.id}-${detail?.messages.length ?? 0}`}
          conversationId={conversationId}
          agent={agent}
          agents={agents}
          onAgentChange={setAgent}
          initialMessages={initialMessages}
          pendingMessage={pending}
          onPendingSent={() => setPending(null)}
          onRefresh={async () => {
            await fetchConversations()
            await fetchDetail(conversationId)
          }}
        />
      </section>

      {/* Team */}
      <aside className="hidden w-[300px] shrink-0 flex-col border-l border-[#f0f0f0] p-5 xl:flex">
        <p className="text-[12px] font-medium uppercase tracking-wide text-[#a3a3a3]">Team</p>
        <div className="mt-3 min-h-0 flex-1 space-y-2 overflow-y-auto">
          {roster.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => {
                const match = agents.find((x) => x.id === a.id)
                if (match) setAgent(match)
              }}
              className="w-full rounded-[14px] border border-[#ebebeb] p-3 text-left hover:bg-[#fafafa]"
            >
              <p className="text-[13px] font-medium text-[#111]">
                {a.emoji} {a.name}
              </p>
              <p className="mt-0.5 text-[12px] text-[#737373]">{a.role}</p>
              {a.tags && a.tags.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {a.tags.slice(0, 3).map((t) => (
                    <span key={t} className="rounded-full bg-[#f4f4f4] px-2 py-0.5 text-[11px] text-[#525252]">
                      {t}
                    </span>
                  ))}
                </div>
              )}
            </button>
          ))}
        </div>
      </aside>
    </div>
  )
}

function AssistantInner() {
  const searchParams = useSearchParams()
  const id = searchParams.get("id")
  const { agents, roster } = useAgents()
  return (
    <div className="p-2">
      <div className="flex min-h-[calc(100vh-1rem)] flex-col overflow-hidden rounded-[18px] border border-[#ebebeb] bg-white text-[#404040] shadow-[0_1px_2px_rgba(0,0,0,0.03)]">
        {id ? <ThreadView agents={agents} roster={roster} conversationId={id} /> : <HomeView agents={agents} />}
      </div>
    </div>
  )
}

export default function AssistantPage() {
  return (
    <Suspense fallback={<div className="flex h-screen items-center justify-center text-[#737373]">Loading…</div>}>
      <AssistantInner />
    </Suspense>
  )
}
