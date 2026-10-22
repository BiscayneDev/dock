"use client"

import { Suspense, useCallback, useEffect, useMemo, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Plus, RotateCcw } from "lucide-react"
import { ChatThread } from "@/components/assistant/ChatThread"
import { Composer, type IntegrationStatus } from "@/components/assistant/Composer"
import { ProjectPicker } from "@/components/assistant/ProjectPicker"
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
  type ProjectOption,
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

interface WorkspaceAgents {
  chief: { id: string; displayName: string; role: string; runtimeAgent: string } | null
}

// The user's Chief of Staff comes first. It runs on its runtime key (runtimeAgent),
// so chat, model routing (AGENT_MODEL_VIC) and conversations keep using the existing path.
// File-based roster agents stay below it; a file agent with the same runtime key is hidden.
function useAgents(): { agents: AgentDef[]; roster: AgentRecord[] } {
  const router = useRouter()
  const [fileRoster, setFileRoster] = useState<AgentRecord[]>([])
  const [chief, setChief] = useState<WorkspaceAgents["chief"]>(null)
  useEffect(() => {
    let cancelled = false
    fetch("/api/agents", { cache: "no-store" })
      .then((r) => r.json())
      .then((data: AgentRecord[]) => {
        if (!cancelled && Array.isArray(data)) setFileRoster(data)
      })
      .catch(() => null)
    fetch("/api/workspace", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<WorkspaceAgents>) : null))
      .then((ws) => {
        if (cancelled || !ws) return
        if (!ws.chief) {
          router.replace("/onboarding")
          return
        }
        setChief(ws.chief)
      })
      .catch(() => null)
    return () => {
      cancelled = true
    }
  }, [router])
  const roster = useMemo<AgentRecord[]>(() => {
    if (!chief) return fileRoster
    const head: AgentRecord = {
      id: chief.runtimeAgent,
      name: chief.displayName,
      emoji: "🤖",
      role: chief.role,
      accent: "#7c3aed",
      description: "Your Chief of Staff. Talk to them directly; they coordinate the rest of the team.",
      tags: [],
    }
    return [head, ...fileRoster.filter((a) => a.id !== chief.runtimeAgent)]
  }, [chief, fileRoster])
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

// The user's projects (ventures) for the project picker and "@" tagging.
function useProjects(): ProjectOption[] {
  const [items, setItems] = useState<ProjectOption[]>([])
  useEffect(() => {
    fetch("/api/workspace", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<{ projects?: ProjectOption[] }>) : null))
      .then((ws) => setItems(ws?.projects?.map((p) => ({ id: p.id, name: p.name })) ?? []))
      .catch(() => null)
  }, [])
  return items
}

/** Sidebar groups: each project in project order, then "No project" last. Empty groups are not shown. */
function groupByProject(
  list: ConversationSummary[],
  projects: ProjectOption[],
  filter: string,
): Array<{ key: string; label: string; items: ConversationSummary[] }> {
  const visible = list.filter((c) => {
    if (filter === "all") return true
    if (filter === "none") return !c.projectId
    return c.projectId === filter
  })
  const groups = new Map<string, { key: string; label: string; items: ConversationSummary[] }>()
  for (const c of visible) {
    const key = c.projectId ?? "none"
    if (!groups.has(key)) {
      groups.set(key, { key, label: c.projectId ? (c.projectName ?? "Project") : "No project", items: [] })
    }
    groups.get(key)!.items.push(c)
  }
  const order = projects.map((p) => p.id)
  const keys = [...groups.keys()]
    .filter((k) => k !== "none")
    .sort((a, b) => (order.indexOf(a) === -1 ? 1e9 : order.indexOf(a)) - (order.indexOf(b) === -1 ? 1e9 : order.indexOf(b)))
  if (groups.has("none")) keys.push("none")
  return keys.map((k) => groups.get(k)!)
}

// The chief of staff is the default agent. The live roster lists the chief first, so no name or id is assumed.
function defaultAgent(agents: AgentDef[]): AgentDef {
  return agents[0] ?? AGENTS[0]
}

function HomeView({
  agents,
  integrations,
  catalog,
  prefill,
  projects,
}: {
  agents: AgentDef[]
  integrations: IntegrationStatus[]
  catalog: ModelCatalog
  prefill: string | null
  projects: ProjectOption[]
}) {
  const router = useRouter()
  const [userName, setUserName] = useState("")
  const [recent, setRecent] = useState<ConversationSummary[]>([])
  const [agentId, setAgentId] = useState<string | null>(null)
  const [text, setText] = useState("")
  const [sending, setSending] = useState(false)
  // The project for the chat being started. Null = "No project". Sent with the first message.
  const [projectId, setProjectId] = useState<string | null>(null)
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
          body: JSON.stringify({ title: trimmed.slice(0, 60), agent: selected.id, projectId }),
        })
        if (!res.ok) throw new Error("create failed")
        const conversation = (await res.json()) as { id: string }
        router.push(`/assistant?id=${encodeURIComponent(conversation.id)}&q=${encodeURIComponent(trimmed)}`)
      } catch {
        setSending(false)
      }
    },
    [router, selected.id, sending, projectId],
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
            projects={projects}
            projectId={projectId}
            onProjectChange={setProjectId}
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
                    {c.projectName ? `${c.projectName} · ` : ""}
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
  projects,
}: {
  agents: AgentDef[]
  roster: AgentRecord[]
  integrations: IntegrationStatus[]
  catalog: ModelCatalog
  conversationId: string
  projects: ProjectOption[]
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const pendingQuery = searchParams.get("q")
  const [pending, setPending] = useState<string | null>(pendingQuery)
  const [conversations, setConversations] = useState<ConversationSummary[]>([])
  const [detail, setDetail] = useState<ConversationDetail | null>(null)
  const [agentId, setAgentId] = useState<string | null>(null)
  // Sidebar filter: "all", "none" (No project) or a project id.
  const [filter, setFilter] = useState<string>("all")
  const [notice, setNotice] = useState<string | null>(null)
  const agent = agents.find((a) => a.id === agentId) ?? defaultAgent(agents)
  const setAgent = useCallback((a: AgentDef) => setAgentId(a.id), [])
  const groups = useMemo(() => groupByProject(conversations, projects, filter), [conversations, projects, filter])
  const currentProjectId = detail?.projectId ?? null
  const projectEditable = detail ? detail.editable !== false : true

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

  // Attaches this chat to a project (or moves it; null = No project). Server checks the project is the user's.
  const changeProject = useCallback(
    async (next: string | null) => {
      setNotice(null)
      const res = await fetch(`/api/conversations/${conversationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: next }),
      })
      const data = (await res.json().catch(() => ({}))) as ConversationDetail & { error?: string }
      if (!res.ok) {
        setNotice(data.error ?? "Could not change the project.")
        return
      }
      setDetail(data)
      await fetchConversations()
    },
    [conversationId, fetchConversations],
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
        <select
          aria-label="Filter chats by project"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="mb-3 w-full rounded-[10px] px-3 py-2 text-[13px] outline-none"
          style={{ background: "var(--surface-0)", border: "1px solid var(--line)", color: "var(--ink-2)" }}
        >
          <option value="all">All chats</option>
          <option value="none">No project</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto">
          {groups.map((group) => (
            <div key={group.key}>
              <p className="px-3 pb-1 text-[11px] font-medium uppercase tracking-wide" style={dim}>
                {group.label}
              </p>
              <div className="space-y-0.5">
                {group.items.map((c) => (
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
            </div>
          ))}
          {conversations.length > 0 && groups.length === 0 && (
            <p className="px-3 text-[12px]" style={dim}>
              No chats in this project yet.
            </p>
          )}
        </div>
      </aside>

      <section className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex items-center justify-between gap-3 px-6 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <h1 className="truncate text-[14px] font-medium" style={ink}>
              {detail?.title ?? "New chat"}
            </h1>
            <ProjectPicker
              projects={projects}
              value={currentProjectId}
              onChange={(id) => changeProject(id).catch(() => null)}
              disabled={!projectEditable || !detail}
              disabledHint="Older chats stay under No project"
            />
          </div>
          <button
            type="button"
            onClick={() => fetchDetail(conversationId).catch(() => null)}
            className="flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] hover:bg-white/5"
            style={dim}
          >
            <RotateCcw size={12} /> Refresh
          </button>
        </div>
        {notice && (
          <p className="px-6 pb-2 text-[12px]" style={{ color: "#f59e0b" }}>
            {notice}
          </p>
        )}
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
          projects={projects}
          projectId={currentProjectId}
          onProjectChange={(id) => changeProject(id).catch(() => null)}
          projectEditable={projectEditable && Boolean(detail)}
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
  const projects = useProjects()
  return (
    <div className="p-2">
      <div
        className="flex min-h-[calc(100vh-1rem)] flex-col overflow-hidden rounded-[18px]"
        style={{ background: "var(--surface-1)", border: "1px solid var(--line)" }}
      >
        {id ? (
          <ThreadView
            agents={agents}
            roster={roster}
            integrations={integrations}
            catalog={catalog}
            conversationId={id}
            projects={projects}
          />
        ) : (
          <HomeView agents={agents} integrations={integrations} catalog={catalog} prefill={prefill} projects={projects} />
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
