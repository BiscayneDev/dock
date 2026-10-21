"use client"

import { useEffect, useState } from "react"
import { useChat, type UIMessage } from "@ai-sdk/react"
import { DefaultChatTransport } from "ai"
import { getText, type AgentDef } from "./shared"
import { Composer } from "./Composer"

export function ChatThread({
  conversationId,
  agent,
  agents,
  onAgentChange,
  initialMessages,
  onRefresh,
  pendingMessage,
  onPendingSent,
}: {
  conversationId: string
  agent: AgentDef
  agents: AgentDef[]
  onAgentChange: (agent: AgentDef) => void
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

  function submit() {
    const text = input.trim()
    if (!text || busy) return
    setInput("")
    sendMessage({ text }).catch(() => null)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-[680px] flex-col gap-6 px-6 py-8">
          {messages.length === 0 && (
            <p className="pt-16 text-center text-[14px] text-[#737373]">Start a conversation with {agent.name}.</p>
          )}
          {messages.map((message) => {
            const isUser = message.role === "user"
            if (isUser) {
              return (
                <div key={message.id} className="flex justify-end">
                  <div className="max-w-[80%] rounded-[18px] bg-[#f4f4f4] px-4 py-2.5 text-[15px] leading-relaxed text-[#111]">
                    <p className="whitespace-pre-wrap">{getText(message)}</p>
                  </div>
                </div>
              )
            }
            return (
              <div key={message.id} className="flex flex-col gap-2">
                <p className="text-[12px] font-medium" style={{ color: agent.accent }}>
                  {agent.emoji} {agent.name}
                </p>
                <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-[#262626]">{getText(message)}</p>
              </div>
            )
          })}
          {busy && <p className="text-[13px] text-[#737373]">{agent.name} is working…</p>}
        </div>
      </div>

      <div className="mx-auto w-full max-w-[680px] px-6 pb-5 pt-2">
        <Composer
          value={input}
          onChange={setInput}
          onSubmit={submit}
          placeholder={`Message ${agent.name}…`}
          agents={agents}
          agent={agent}
          onAgentChange={onAgentChange}
          busy={busy}
        />
      </div>
    </div>
  )
}
