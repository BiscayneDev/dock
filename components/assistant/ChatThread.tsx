"use client"

import { useEffect, useState } from "react"
import { useChat, type UIMessage } from "@ai-sdk/react"
import { DefaultChatTransport } from "ai"
import { Copy, Check, RotateCcw } from "lucide-react"
import { getText, type AgentDef } from "./shared"
import { Composer, type IntegrationStatus } from "./Composer"
import { readStoredModel, storeModel, type ModelRef, type ProviderModels } from "./ModelPicker"

export interface Attachment {
  name: string
  size: number
  content: string
}

const MAX_ATTACHMENT_BYTES = 200 * 1024

function AnswerMessage({
  text,
  agent,
  isLast,
  onRegenerate,
}: {
  text: string
  agent: AgentDef
  isLast: boolean
  onRegenerate?: () => void
}) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[12px] font-medium" style={{ color: agent.accent }}>
        {agent.emoji} {agent.name}
      </p>
      <p className="whitespace-pre-wrap text-[15px] leading-relaxed" style={{ color: "var(--ink)" }}>
        {text}
      </p>
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
  models,
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
  models: ProviderModels[]
}) {
  const [input, setInput] = useState("")
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [attachError, setAttachError] = useState<string | null>(null)
  // Per-message model: null = Auto (agent default; no `model` field is sent).
  const [model, setModelState] = useState<ModelRef>(null)
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

  // Restore the model chosen on the home page / earlier in this tab.
  useEffect(() => {
    setModelState(readStoredModel())
  }, [])

  function setModel(ref: ModelRef) {
    setModelState(ref)
    storeModel(ref)
  }

  // A message typed on the assistant home is sent once the thread mounts.
  useEffect(() => {
    if (!pendingMessage) return
    onPendingSent?.()
    const chosen = readStoredModel()
    sendMessage({ text: pendingMessage }, chosen ? { body: { model: chosen } } : undefined).catch(() => null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingMessage])

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

  function submit() {
    const text = input.trim()
    if ((!text && attachments.length === 0) || busy) return
    const body = attachments.map((a) => `\n\n--- Attached: ${a.name} ---\n${a.content}`).join("")
    setInput("")
    setAttachments([])
    sendMessage(
      { text: `${text || "Here are the attached files."}${body}` },
      model ? { body: { model } } : undefined,
    ).catch(() => null)
  }

  const lastAssistantIndex = messages.map((m) => m.role).lastIndexOf("assistant")

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
              />
            )
          })}
          {busy && (
            <p className="text-[13px]" style={{ color: "var(--ink-3)" }}>
              {agent.name} is working…
            </p>
          )}
        </div>
      </div>

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
          models={models}
          model={model}
          onModelChange={setModel}
        />
      </div>
    </div>
  )
}
