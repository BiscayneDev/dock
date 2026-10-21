"use client"

import { useEffect, useState } from "react"
import { useChat, type UIMessage } from "@ai-sdk/react"
import { DefaultChatTransport } from "ai"
import { getText, type AgentDef } from "./shared"

export function ChatThread({
  conversationId,
  agent,
  initialMessages,
  onRefresh,
  pendingMessage,
  onPendingSent,
}: {
  conversationId: string
  agent: AgentDef
  initialMessages: UIMessage[]
  onRefresh: () => Promise<void>
  pendingMessage?: string | null
  onPendingSent?: () => void
}) {
  const [input, setInput] = useState("")
  const { messages, sendMessage, status, setMessages } = useChat({
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

  // A message typed on the assistant home is sent once the thread mounts.
  useEffect(() => {
    if (!pendingMessage) return
    onPendingSent?.()
    sendMessage({ text: pendingMessage }).catch(() => null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingMessage])

  const busy = status === "submitted" || status === "streaming"

  async function submit(text: string) {
    const trimmed = text.trim()
    if (!trimmed || status !== "ready") return
    setInput("")
    await sendMessage({ text: trimmed })
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-6">
        {messages.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm" style={{ color: "var(--ink-3)" }}>
            Start a conversation with {agent.name}.
          </div>
        ) : (
          messages.map((message) => {
            const isUser = message.role === "user"
            return (
              <div key={message.id} className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
                <div
                  className="max-w-[80%] rounded-2xl px-4 py-3 text-sm leading-relaxed"
                  style={{
                    background: isUser ? "var(--surface-2)" : "transparent",
                    border: isUser ? "1px solid var(--line)" : "none",
                    color: "var(--ink)",
                    padding: isUser ? undefined : "0",
                  }}
                >
                  {!isUser && (
                    <p className="mb-1 text-[11px] uppercase tracking-wide" style={{ color: agent.accent }}>
                      {agent.emoji} {agent.name}
                    </p>
                  )}
                  <p className="whitespace-pre-wrap">{getText(message)}</p>
                </div>
              </div>
            )
          })
        )}
        {busy && (
          <p className="text-xs" style={{ color: "var(--ink-3)" }}>
            {agent.name} is working…
          </p>
        )}
      </div>

      <div className="px-6 pb-6 pt-2">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            submit(input).catch(() => null)
          }}
          className="flex items-end gap-2 rounded-2xl p-3"
          style={{ background: "var(--surface-1)", border: "1px solid var(--line)" }}
        >
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault()
                submit(input).catch(() => null)
              }
            }}
            placeholder={`Message ${agent.name}…`}
            rows={2}
            className="min-h-[44px] flex-1 resize-none bg-transparent px-1 py-1 text-sm outline-none"
            style={{ color: "var(--ink)" }}
          />
          <button
            type="submit"
            disabled={busy || !input.trim()}
            className="rounded-xl px-4 py-2 text-sm font-medium disabled:opacity-40"
            style={{ background: "var(--ink)", color: "var(--surface-0)" }}
          >
            {busy ? "Working…" : "Send"}
          </button>
        </form>
      </div>
    </div>
  )
}
