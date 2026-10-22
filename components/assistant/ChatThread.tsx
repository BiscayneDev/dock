"use client"

import { useEffect, useState } from "react"
import { useChat, type UIMessage } from "@ai-sdk/react"
import { DefaultChatTransport } from "ai"
import { Copy, Check, RotateCcw, ChevronRight } from "lucide-react"
import { getText, type AgentDef, type ProjectOption } from "./shared"
import { TraceWaterfall } from "@/components/runs/TraceWaterfall"
import type { ConversationEvent, ConversationRun } from "@/lib/conversations"
import { Composer, type IntegrationStatus } from "./Composer"
import { readStoredModel, storeModel, type ModelCatalog, type ModelRef } from "./ModelPicker"
import { BriefCard, LedgerPanel } from "./BriefCard"
import { ApprovalCards } from "./ApprovalCard"
import { stripBriefBlocks } from "@/lib/briefs"

export interface Attachment {
  name: string
  size: number
  content: string
}

const MAX_ATTACHMENT_BYTES = 200 * 1024

type RunPayload = { run: ConversationRun; events: ConversationEvent[] }

// Lazy: fetches the run once on first expand and keeps it in component state.
function RunTrace({ conversationId, runId }: { conversationId: string; runId: string }) {
  const [open, setOpen] = useState(false)
  const [data, setData] = useState<RunPayload | null>(null)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!open || data) return
    setLoading(true)
    setFailed(false)
    fetch(`/api/runs/${encodeURIComponent(conversationId)}/${encodeURIComponent(runId)}`, { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return (await res.json()) as RunPayload
      })
      .then((payload) => setData(payload))
      .catch(() => setFailed(true))
      .finally(() => setLoading(false))
  }, [open, data, conversationId, runId])

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-fit items-center gap-1 rounded-full px-2.5 py-1 text-[12px] hover:bg-white/5"
        style={{ color: "var(--ink-3)" }}
      >
        <ChevronRight size={12} className={open ? "rotate-90 transition-transform" : "transition-transform"} /> Trace
      </button>
      {open && loading && (
        <p className="text-[12px]" style={{ color: "var(--ink-3)" }}>
          Loading trace…
        </p>
      )}
      {open && failed && (
        <p className="text-[12px]" style={{ color: "#f59e0b" }}>
          Trace unavailable: the run could not be loaded.{" "}
          <button type="button" className="underline" onClick={() => setData(null)}>
            Retry
          </button>
        </p>
      )}
      {open && data && <TraceWaterfall run={data.run} events={data.events} />}
    </div>
  )
}

function AnswerMessage({
  text,
  agent,
  isLast,
  onRegenerate,
  conversationId,
  runId,
  briefIds,
  kind,
  onSettled,
  onMakeTask,
}: {
  text: string
  agent: AgentDef
  isLast: boolean
  onRegenerate?: () => void
  conversationId: string
  runId?: string
  briefIds?: string[]
  kind?: string
  onSettled?: () => void
  onMakeTask?: (text: string) => void
}) {
  const [copied, setCopied] = useState(false)
  const visible = stripBriefBlocks(text)
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[12px] font-medium" style={{ color: agent.accent }}>
        {agent.emoji} {agent.name}
        {kind === "result" && <span style={{ color: "var(--ink-3)" }}> · result</span>}
      </p>
      {visible && (
        <p className="whitespace-pre-wrap text-[15px] leading-relaxed" style={{ color: "var(--ink)" }}>
          {visible}
        </p>
      )}
      {briefIds?.map((id) => (
        <BriefCard key={id} briefId={id} onSettled={onSettled} />
      ))}
      <div className="flex items-center gap-1 pt-1">
        <button
          type="button"
          onClick={() => {
            navigator.clipboard?.writeText(text).catch(() => null)
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
          }}
          className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] hover:bg-white/5"
          style={{ color: "var(--ink-3)" }}
        >
          {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? "Copied" : "Copy"}
        </button>
        {onMakeTask && visible && (
          <button
            type="button"
            onClick={() => onMakeTask(visible)}
            className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] hover:bg-white/5"
            style={{ color: "var(--ink-3)" }}
          >
            Make this a task
          </button>
        )}
        {isLast && onRegenerate && (
          <button
            type="button"
            onClick={onRegenerate}
            className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] hover:bg-white/5"
            style={{ color: "var(--ink-3)" }}
          >
            <RotateCcw size={12} /> Regenerate
          </button>
        )}
      </div>
      {runId && <RunTrace conversationId={conversationId} runId={runId} />}
    </div>
  )
}

export function ChatThread({
  conversationId,
  agent,
  agents,
  onAgentChange,
  initialMessages,
  onRefresh,
  pendingMessage,
  onPendingSent,
  integrations,
  catalog,
  projects,
  projectId,
  onProjectChange,
  projectEditable,
}: {
  conversationId: string
  agent: AgentDef
  agents: AgentDef[]
  onAgentChange: (agent: AgentDef) => void
  initialMessages: UIMessage[]
  onRefresh: () => Promise<void>
  pendingMessage?: string | null
  onPendingSent?: () => void
  integrations: IntegrationStatus[]
  catalog: ModelCatalog
  projects?: ProjectOption[]
  projectId?: string | null
  onProjectChange?: (projectId: string | null) => void
  projectEditable?: boolean
}) {
  const [input, setInput] = useState("")
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [attachError, setAttachError] = useState<string | null>(null)
  // Effective model: null = Auto (no `model` field is sent).
  const [model, setModelState] = useState<ModelRef>(null)
  // Background mode: the message is queued as a cloud run instead of streamed here. Off by default.
  const [background, setBackground] = useState(false)
  const [runTarget, setRunTarget] = useState<"cloud" | "home">("cloud")
  const [queuedNote, setQueuedNote] = useState<string | null>(null)
  const { messages, sendMessage, status, setMessages, regenerate } = useChat({
    id: `chat-${conversationId}-${agent.id}`,
    messages: initialMessages,
    transport: new DefaultChatTransport({
      api: "/api/chat/stream",
      body: { conversationId, agent: agent.id },
    }),
    onFinish: async () => {
      await onRefresh()
    },
  })

  useEffect(() => {
    setMessages(initialMessages)
  }, [initialMessages, setMessages])

  // Restore the model chosen on the home page / earlier in this tab. With no
  // stored choice, the catalog default (Shipyard when configured) applies.
  useEffect(() => {
    setModelState(readStoredModel(catalog.defaultModel))
  }, [catalog.defaultModel])

  function setModel(ref: ModelRef) {
    setModelState(ref)
    storeModel(ref)
  }

  // A message typed on the assistant home is sent once the thread mounts and
  // the catalog has settled, so the default model is known before sending.
  useEffect(() => {
    if (!pendingMessage || !catalog.loaded) return
    onPendingSent?.()
    const chosen = readStoredModel(catalog.defaultModel)
    sendMessage({ text: pendingMessage }, chosen ? { body: { model: chosen } } : undefined).catch(() => null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingMessage, catalog.loaded])

  const busy = status === "submitted" || status === "streaming"

  async function attach(files: FileList) {
    setAttachError(null)
    const next: Attachment[] = []
    for (const file of Array.from(files)) {
      if (file.size > MAX_ATTACHMENT_BYTES) {
        setAttachError(`${file.name} is over 200 KB and was skipped.`)
        continue
      }
      next.push({ name: file.name, size: file.size, content: await file.text() })
    }
    setAttachments((prev) => [...prev, ...next])
  }

  async function queueBackground(prompt: string, chosen: ModelRef, target: "cloud" | "home") {
    setQueuedNote(null)
    try {
      const res = await fetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          agent: agent.id,
          budget_cents: 100,
          target,
          conversation_id: conversationId,
          ...(chosen ? { model: chosen } : {}),
        }),
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      const ok =
        target === "home"
          ? "Queued for your laptop. It runs when dock-node is online; nothing runs in the cloud instead."
          : "Queued for the cloud worker. Follow it in Tasks."
      setQueuedNote(res.ok ? ok : (data.error ?? "Could not queue the run"))
    } catch {
      setQueuedNote("Could not queue the run")
    }
  }

  function submit() {
    const text = input.trim()
    if ((!text && attachments.length === 0) || busy) return
    const body = attachments.map((a) => `\n\n--- Attached: ${a.name} ---\n${a.content}`).join("")
    setInput("")
    setAttachments([])
    const full = `${text || "Here are the attached files."}${body}`
    if (background) {
      queueBackground(full, model, runTarget).catch(() => null)
      return
    }
    sendMessage({ text: full }, model ? { body: { model } } : undefined).catch(() => null)
  }

  const lastAssistantIndex = messages.map((m) => m.role).lastIndexOf("assistant")

  // "Make this a task": the chief turns the selected message into a task proposal. The owner still approves it.
  const makeTask = projectId
    ? (text: string) => {
        if (busy) return
        const request = `Make this a task for the team. Propose it as a task block, or say why it is not real work:\n\n${text}`
        sendMessage({ text: request }, model ? { body: { model } } : undefined).catch(() => null)
      }
    : undefined

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-[680px] flex-col gap-7 px-6 py-8">
          {messages.length === 0 && (
            <p className="pt-16 text-center text-[14px]" style={{ color: "var(--ink-3)" }}>
              Start a conversation with {agent.name}.
            </p>
          )}
          {messages.map((message, index) => {
            if (message.role === "user") {
              return (
                <div key={message.id} className="flex justify-end">
                  <div
                    className="max-w-[80%] rounded-[18px] px-4 py-2.5 text-[15px] leading-relaxed"
                    style={{ background: "var(--surface-2)", color: "var(--ink)" }}
                  >
                    <p className="whitespace-pre-wrap">{getText(message)}</p>
                  </div>
                  {makeTask && (
                    <button
                      type="button"
                      onClick={() => makeTask(getText(message))}
                      className="ml-2 self-end rounded-full px-2.5 py-1 text-[12px] hover:bg-white/5"
                      style={{ color: "var(--ink-3)" }}
                    >
                      Make this a task
                    </button>
                  )}
                </div>
              )
            }
            return (
              <AnswerMessage
                key={message.id}
                text={getText(message)}
                agent={agent}
                isLast={index === lastAssistantIndex && !busy}
                onRegenerate={() => regenerate(model ? { body: { model } } : undefined).catch(() => null)}
                conversationId={conversationId}
                runId={(message.metadata as { runId?: string } | undefined)?.runId}
                briefIds={(message.metadata as { briefIds?: string[] } | undefined)?.briefIds}
                kind={(message.metadata as { kind?: string } | undefined)?.kind}
                onSettled={() => {
                  onRefresh().catch(() => null)
                }}
                onMakeTask={makeTask}
              />
            )
          })}
          {conversationId && <ApprovalCards conversationId={conversationId} refreshKey={messages.length} />}
          {busy && (
            <p className="text-[13px]" style={{ color: "var(--ink-3)" }}>
              {agent.name} is working…
            </p>
          )}
        </div>
      </div>

      {projectId && (
        <div className="shrink-0 pb-1">
          <LedgerPanel projectId={projectId} refreshKey={messages.length} />
        </div>
      )}

      <div className="mx-auto w-full max-w-[680px] px-6 pb-5 pt-2">
        {attachError && (
          <p className="mb-2 text-[12px]" style={{ color: "#f59e0b" }}>
            {attachError}
          </p>
        )}
        <Composer
          value={input}
          onChange={setInput}
          onSubmit={submit}
          placeholder={`Message ${agent.name}…`}
          agents={agents}
          agent={agent}
          onAgentChange={onAgentChange}
          busy={busy}
          integrations={integrations}
          attachments={attachments}
          onAttach={(files) => attach(files).catch(() => null)}
          onRemoveAttachment={(i) => setAttachments((prev) => prev.filter((_, idx) => idx !== i))}
          showQuickActions
          models={catalog.providers}
          model={model}
          onModelChange={setModel}
          projects={projects}
          projectId={projectId}
          onProjectChange={onProjectChange}
          projectEditable={projectEditable}
          background={background}
          onBackgroundChange={(value) => {
            setBackground(value)
            setQueuedNote(null)
          }}
          runTarget={runTarget}
          onRunTargetChange={(value) => {
            setRunTarget(value)
            setQueuedNote(null)
          }}
        />
        {queuedNote && (
          <p className="px-3 pt-1 text-[12px]" style={{ color: "var(--ink-3)" }} role="status">
            {queuedNote}
          </p>
        )}
      </div>
    </div>
  )
}
