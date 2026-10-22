"use client"

import { Suspense, useCallback, useEffect, useMemo, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Plus, RotateCcw } from "lucide-react"
import { ChatThread } from "@/components/assistant/ChatThread"
import { Composer, type IntegrationStatus } from "@/components/assistant/Composer"
import {
  readStoredModel,
  storeModel,
  useModelCatalog,
  type ModelCatalog,
  type ModelRef,
} from "@/components/assistant/ModelPicker"
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

const SUGGESTIONS = [
  "What needs me today?",
  "Brief a new task",
  "Summarize what the agents did",
  "How much have we spent this week?",
]

const dim = { color: "var(--ink-3)" }
const ink = { color: "var(--ink)" }

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

function useIntegrations(): IntegrationStatus[] {
  const [items, setItems] = useState<IntegrationStatus[]>([])
  useEffect(() => {
    fetch("/api/settings/status", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: IntegrationStatus[]) => setItems(Array.isArray(d) ? d : []))
      .catch(() => null)
  }, [])
  return items
}

// Vic (chief of staff) is the default agent unless the user picks another one.
function defaultAgent(agents: AgentDef[]): AgentDef {
  return agents.find((a) => a.id === "vic") ?? agents[0] ?? AGENTS[0]
}

function HomeView({
  agents,
  integrations,
  catalog,
  prefill,
}: {
  agents: AgentDef[]
  integrations: IntegrationStatus[]
  catalog: ModelCatalog
  prefill: string | null
}) {
  const router = useRouter()
  const [userName, setUserName] = useState("")
  const [recent, setRecent] = useState<ConversationSummary[]>([])
  const [agentId, setAgentId] = useState<string | null>(null)
  const [text, setText] = useState("")
  const [sending, setSending] = useState(false)
  // Stored in sessionStorage ("dock:model") so the thread picks it up on navigation.
  const [model, setModelState] = useState<ModelRef>(null)

  useEffect(() => {
    setModelState(readStoredModel(catalog.defaultModel))
  }, [catalog.defaultModel])

  // ?prefill=<text> (from the Launch button, command palette, dashboard) fills the composer once, then clears the param.
  useEffect(() => {
    if (prefill) {
      setText(prefill)
      router.replace("/assistant")
    }
  }, [prefill, router])

  function setModel(ref: ModelRef) {
    setModelState(ref)
    storeModel(ref)
  }

  useEffect(() => {
    fetch("/api/setup/status", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { userName?: string }) => d.userName && setUserName(d.userName))
      .catch(() => null)
    fetch("/api/conversations", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: ConversationSummary[]) => setRecent(Array.isArray(d) ? d.slice(0, 4) : []))
      .catch(() => null)
  }, [])

  const selected = agents.find((a) => a.id === agentId) ?? defaultAgent(agents)

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
        <h1 className="text-center text-[34px] font-semibold tracking-[-0.02em]" style={ink}>
          {greetingFor(userName)}!
        </h1>
        <p className="mt-1 text-center text-[34px] font-semibold tracking-[-0.02em]" style={dim}>
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
            onAgentChange={(a) => setAgentId(a.id)}
            busy={sending}
            integrations={integrations}
            attachments={[]}
            onAttach={() => null}
            onRemoveAttachment={() => null}
            models={catalog.providers}
            model={model}
            onModelChange={setModel}
          />
        </div>

        <div className="mt-5 flex flex-wrap justify-center gap-2">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => start(s)}
              className="rounded-full px-4 py-2 text-[13px] hover:bg-white/5"
              style={{ background: "var(--surface-1)", border: "1px solid var(--line)", color: "var(--ink-2)" }}
            >
              {s}
            </button>
          ))}
        </div>

        {recent.length > 0 && (
          <div className="mt-12 w-full">
            <p className="text-[12px] font-medium uppercase tracking-wide" style={dim}>
              Recent
            </p>
            <div className="mt-2 divide-y" style={{ borderColor: "var(--line)" }}>
              {recent.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => router.push(`/assistant?id=${encodeURIComponent(c.id)}`)}
                  className="flex w-full items-center justify-between gap-4 py-3 text-left"
                >
                  <span className="truncate text-[14px]" style={{ color: "var(--ink-2)" }}>
                    {c.title}
                  </span>
                  <span className="shrink-0 text-[12px]" style={dim}>
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
  integrations,
  catalog,
  conversationId,
}: {
  agents: AgentDef[]
  roster: AgentRecord[]
  integrations: IntegrationStatus[]
  catalog: ModelCatalog
  conversationId: string
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const pendingQuery = searchParams.get("q")
  const [pending, setPending] = useState<string | null>(pendingQuery)
  const [conversations, setConversations] = useState<ConversationSummary[]>([])
  const [detail, setDetail] = useState<ConversationDetail | null>(null)
  const [agentId, setAgentId] = useState<string | null>(null)
  const agent = agents.find((a) => a.id === agentId) ?? defaultAgent(agents)
  const setAgent = useCallback((a: AgentDef) => setAgentId(a.id), [])

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
    [agents, setAgent],
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
      <aside className="hidden w-60 shrink-0 flex-col p-3 md:flex" style={{ borderRight: "1px solid var(--line)" }}>
        <button
          type="button"
          onClick={() => router.push("/assistant")}
          className="mb-3 flex items-center gap-2 rounded-[10px] px-3 py-2 text-[13px] hover:bg-white/5"
          style={{ border: "1px solid var(--line)", color: "var(--ink-2)" }}
        >
          <Plus size={14} /> New chat
        </button>
        <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto">
          {conversations.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => router.push(`/assistant?id=${encodeURIComponent(c.id)}`)}
              className="w-full rounded-[10px] px-3 py-2 text-left hover:bg-white/5"
              style={{ background: c.id === conversationId ? "var(--surface-2)" : "transparent" }}
            >
              <p className="truncate text-[13px]" style={{ color: "var(--ink-2)" }}>
                {c.title}
              </p>
              <p className="text-[11px]" style={dim}>
                {c.agent} · {relativeTime(c.updatedAt)}
              </p>
            </button>
          ))}
        </div>
      </aside>

      <section className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex items-center justify-between px-6 py-3">
          <h1 className="truncate text-[14px] font-medium" style={ink}>
            {detail?.title ?? "New chat"}
          </h1>
          <button
            type="button"
            onClick={() => fetchDetail(conversationId).catch(() => null)}
            className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] hover:bg-white/5"
            style={dim}
          >
            <RotateCcw size={12} /> Refresh
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
          integrations={integrations}
          catalog={catalog}
          onRefresh={async () => {
            await fetchConversations()
            await fetchDetail(conversationId)
          }}
        />
      </section>

      <aside className="hidden w-[300px] shrink-0 flex-col p-5 xl:flex" style={{ borderLeft: "1px solid var(--line)" }}>
        <p className="text-[12px] font-medium uppercase tracking-wide" style={dim}>
          Team
        </p>
        <div className="mt-3 min-h-0 flex-1 space-y-2 overflow-y-auto">
          {roster.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => {
                const match = agents.find((x) => x.id === a.id)
                if (match) setAgent(match)
              }}
              className="w-full rounded-[14px] p-3 text-left hover:bg-white/5"
              style={{ border: "1px solid var(--line)" }}
            >
              <p className="text-[13px] font-medium" style={{ color: a.accent }}>
                {a.emoji} {a.name}
              </p>
              <p className="mt-0.5 text-[12px]" style={dim}>
                {a.role}
              </p>
              {a.tags && a.tags.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {a.tags.slice(0, 3).map((t) => (
                    <span key={t} className="rounded-full px-2 py-0.5 text-[11px]" style={{ background: "var(--surface-2)", color: "var(--ink-2)" }}>
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
  const prefill = searchParams.get("prefill")
  const { agents, roster } = useAgents()
  const integrations = useIntegrations()
  const catalog = useModelCatalog()
  return (
    <div className="p-2">
      <div
        className="flex min-h-[calc(100vh-1rem)] flex-col overflow-hidden rounded-[18px]"
        style={{ background: "var(--surface-1)", border: "1px solid var(--line)" }}
      >
        {id ? (
          <ThreadView agents={agents} roster={roster} integrations={integrations} catalog={catalog} conversationId={id} />
        ) : (
          <HomeView agents={agents} integrations={integrations} catalog={catalog} prefill={prefill} />
        )}
      </div>
    </div>
  )
}

export default function AssistantPage() {
  return (
    <Suspense fallback={<div className="flex h-screen items-center justify-center" style={dim}>Loading…</div>}>
      <AssistantInner />
    </Suspense>
  )
}
