"use client"

import { Suspense, useCallback, useEffect, useMemo, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { ChevronDown, Plus, RotateCcw } from "lucide-react"
import { ChatThread } from "@/components/assistant/ChatThread"
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
]

function useAgents(): AgentDef[] {
  const [agents, setAgents] = useState<AgentDef[]>(AGENTS)
  useEffect(() => {
    let cancelled = false
    fetch("/api/agents", { cache: "no-store" })
      .then((r) => r.json())
      .then((data: AgentRecord[]) => {
        if (cancelled || !Array.isArray(data) || data.length === 0) return
        setAgents(
          data.map((a) => ({ id: a.id, name: a.name, emoji: a.emoji, accent: a.accent, description: a.role })),
        )
      })
      .catch(() => null)
    return () => {
      cancelled = true
    }
  }, [])
  return agents
}

function AgentSelect({
  agents,
  value,
  onChange,
}: {
  agents: AgentDef[]
  value: AgentDef
  onChange: (agent: AgentDef) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm"
        style={{ background: "var(--surface-2)", border: "1px solid var(--line)", color: "var(--ink)" }}
      >
        <span>{value.emoji}</span>
        <span style={{ color: value.accent }}>{value.name}</span>
        <ChevronDown size={12} style={{ color: "var(--ink-3)" }} />
      </button>
      {open && (
        <div
          className="absolute left-0 top-full z-20 mt-1 w-60 overflow-hidden rounded-xl shadow-xl"
          style={{ background: "var(--surface-1)", border: "1px solid var(--line)" }}
        >
          {agents.map((agent) => (
            <button
              key={agent.id}
              type="button"
              onClick={() => {
                onChange(agent)
                setOpen(false)
              }}
              className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-sm hover:bg-white/5"
            >
              <span>{agent.emoji}</span>
              <div>
                <p className="font-medium" style={{ color: agent.accent }}>
                  {agent.name}
                </p>
                <p className="text-[11px]" style={{ color: "var(--ink-3)" }}>
                  {agent.description}
                </p>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
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
      .then((d: { userName?: string }) => {
        if (d.userName) setUserName(d.userName)
      })
      .catch(() => null)
    fetch("/api/settings/status", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: IntegrationStatus[]) => setIntegrations(Array.isArray(d) ? d : []))
      .catch(() => null)
    fetch("/api/conversations", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: ConversationSummary[]) => setRecent(Array.isArray(d) ? d.slice(0, 5) : []))
      .catch(() => null)
  }, [])

  useEffect(() => {
    if (agents.length && !agents.some((a) => a.id === agent.id)) setAgent(agents[0])
  }, [agents, agent.id])

  const start = useCallback(
    async (message: string) => {
      const trimmed = message.trim()
      if (!trimmed || sending) return
      setSending(true)
      try {
        const res = await fetch("/api/conversations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: trimmed.slice(0, 60), agent: agent.id }),
        })
        if (!res.ok) throw new Error("create failed")
        const conversation = (await res.json()) as { id: string }
        router.push(`/assistant?id=${encodeURIComponent(conversation.id)}&q=${encodeURIComponent(trimmed)}`)
      } catch {
        setSending(false)
      }
    },
    [agent.id, router, sending],
  )

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col px-6 pt-16">
      <h1 className="text-3xl font-semibold tracking-tight" style={{ color: "var(--ink)" }}>
        {greetingFor(userName)}
      </h1>
      <p className="mt-2 text-sm" style={{ color: "var(--ink-3)" }}>
        What should the team work on?
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          start(text).catch(() => null)
        }}
        className="mt-8 rounded-2xl p-4"
        style={{ background: "var(--surface-1)", border: "1px solid var(--line)" }}
      >
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault()
              start(text).catch(() => null)
            }
          }}
          placeholder="Ask anything, or hand a task to an agent…"
          rows={3}
          className="w-full resize-none bg-transparent text-base outline-none"
          style={{ color: "var(--ink)" }}
        />
        <div className="mt-3 flex items-center justify-between">
          <AgentSelect agents={agents} value={agent} onChange={setAgent} />
          <button
            type="submit"
            disabled={!text.trim() || sending}
            className="rounded-xl px-4 py-2 text-sm font-medium disabled:opacity-40"
            style={{ background: "var(--ink)", color: "var(--surface-0)" }}
          >
            {sending ? "Starting…" : "Send"}
          </button>
        </div>
      </form>

      <div className="mt-4 flex flex-wrap gap-2">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => start(s)}
            className="rounded-full px-3 py-1.5 text-xs"
            style={{ background: "var(--surface-1)", border: "1px solid var(--line)", color: "var(--ink-2)" }}
          >
            {s}
          </button>
        ))}
      </div>

      {integrations.length > 0 && (
        <section className="mt-10">
          <h2 className="text-xs uppercase tracking-wide" style={{ color: "var(--ink-3)" }}>
            Connected apps
          </h2>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {integrations.map((i) => (
              <div
                key={i.id}
                className="rounded-xl px-3 py-2.5"
                style={{ background: "var(--surface-1)", border: "1px solid var(--line)" }}
              >
                <p className="text-sm" style={{ color: "var(--ink)" }}>
                  {i.name}
                </p>
                <p className="mt-0.5 text-[11px]" style={{ color: i.connected ? "#10b981" : "var(--ink-3)" }}>
                  {i.connected ? "Connected" : i.error ?? "Not connected"}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}

      {recent.length > 0 && (
        <section className="mt-10 pb-16">
          <h2 className="text-xs uppercase tracking-wide" style={{ color: "var(--ink-3)" }}>
            Recent
          </h2>
          <div className="mt-3 divide-y" style={{ borderColor: "var(--line)" }}>
            {recent.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => router.push(`/assistant?id=${encodeURIComponent(c.id)}`)}
                className="flex w-full items-center justify-between gap-4 py-3 text-left"
              >
                <span className="truncate text-sm" style={{ color: "var(--ink)" }}>
                  {c.title}
                </span>
                <span className="shrink-0 text-xs" style={{ color: "var(--ink-3)" }}>
                  {c.agent} · {relativeTime(c.updatedAt)}
                </span>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

function ThreadView({ agents, conversationId }: { agents: AgentDef[]; conversationId: string }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const pendingQuery = searchParams.get("q")
  const [pending, setPending] = useState<string | null>(pendingQuery)
  const [conversations, setConversations] = useState<ConversationSummary[]>([])
  const [detail, setDetail] = useState<ConversationDetail | null>(null)
  const [agent, setAgent] = useState<AgentDef>(agents[0] ?? AGENTS[0])
  const [roster, setRoster] = useState<AgentRecord[]>([])

  const fetchConversations = useCallback(async () => {
    const res = await fetch("/api/conversations", { cache: "no-store" })
    const data = (await res.json()) as ConversationSummary[]
    setConversations(Array.isArray(data) ? data : [])
  }, [])

  const fetchDetail = useCallback(async (id: string) => {
    const res = await fetch(`/api/conversations/${id}`, { cache: "no-store" })
    if (!res.ok) return
    const data = (await res.json()) as ConversationDetail
    setDetail(data)
    const match = AGENTS.concat(agents).find((a) => a.id === data.agent)
    if (match) setAgent(match)
  }, [agents])

  useEffect(() => {
    fetchConversations().catch(() => null)
    fetch("/api/agents", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: AgentRecord[]) => setRoster(Array.isArray(d) ? d : []))
      .catch(() => null)
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
    <div className="flex h-[calc(100vh-1rem)] min-h-0 gap-4 px-4 pb-4 pt-2">
      <aside className="hidden w-60 shrink-0 flex-col md:flex">
        <button
          type="button"
          onClick={() => router.push("/assistant")}
          className="mb-3 flex items-center gap-2 rounded-xl px-3 py-2 text-sm"
          style={{ border: "1px solid var(--line)", color: "var(--ink-2)" }}
        >
          <Plus size={14} /> New chat
        </button>
        <div className="min-h-0 flex-1 space-y-1 overflow-y-auto">
          {conversations.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => router.push(`/assistant?id=${encodeURIComponent(c.id)}`)}
              className="w-full rounded-xl px-3 py-2 text-left"
              style={{
                background: c.id === conversationId ? "var(--surface-2)" : "transparent",
                color: "var(--ink)",
              }}
            >
              <p className="truncate text-sm">{c.title}</p>
              <p className="text-[11px]" style={{ color: "var(--ink-3)" }}>
                {c.agent} · {relativeTime(c.updatedAt)}
              </p>
            </button>
          ))}
        </div>
      </aside>

      <section
        className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-2xl"
        style={{ background: "var(--surface-1)", border: "1px solid var(--line)" }}
      >
        <div className="flex items-center justify-between gap-3 px-6 py-4" style={{ borderBottom: "1px solid var(--line)" }}>
          <div className="min-w-0">
            <h1 className="truncate text-base font-semibold" style={{ color: "var(--ink)" }}>
              {detail?.title ?? "New chat"}
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => fetchDetail(conversationId).catch(() => null)}
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs"
              style={{ color: "var(--ink-3)" }}
            >
              <RotateCcw size={12} /> Refresh
            </button>
            <AgentSelect agents={agents} value={agent} onChange={setAgent} />
          </div>
        </div>

        <ChatThread
          key={`${conversationId}-${agent.id}-${detail?.messages.length ?? 0}`}
          conversationId={conversationId}
          agent={agent}
          initialMessages={initialMessages}
          pendingMessage={pending}
          onPendingSent={() => setPending(null)}
          onRefresh={async () => {
            await fetchConversations()
            await fetchDetail(conversationId)
          }}
        />
      </section>

      <aside className="hidden w-64 shrink-0 flex-col xl:flex">
        <p className="mb-3 text-xs uppercase tracking-wide" style={{ color: "var(--ink-3)" }}>
          Team
        </p>
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
          {roster.map((a) => (
            <div
              key={a.id}
              className="rounded-xl px-3 py-2.5"
              style={{ background: "var(--surface-1)", border: "1px solid var(--line)" }}
            >
              <p className="text-sm" style={{ color: a.accent }}>
                {a.emoji} {a.name}
              </p>
              <p className="mt-0.5 text-[11px]" style={{ color: "var(--ink-3)" }}>
                {a.role}
              </p>
            </div>
          ))}
        </div>
      </aside>
    </div>
  )
}

function AssistantInner() {
  const searchParams = useSearchParams()
  const id = searchParams.get("id")
  const agents = useAgents()
  if (!id) return <HomeView agents={agents} />
  return <ThreadView agents={agents} conversationId={id} />
}

export default function AssistantPage() {
  return (
    <Suspense fallback={<div className="flex h-screen items-center justify-center" style={{ color: "var(--ink-3)" }}>Loading…</div>}>
      <AssistantInner />
    </Suspense>
  )
}
