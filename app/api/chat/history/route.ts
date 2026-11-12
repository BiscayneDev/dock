import { NextResponse } from "next/server"
import { ConversationMessage, getDefaultConversation, replaceDefaultConversationMessages } from "@/lib/conversations"

interface ChatMessage {
  id: string
  role: "user" | "assistant"
  text: string
  agent: string
  timestamp: number
}

// Known roles only. "agent" (worker results) renders as the assistant, like the main chat UI does.
// An unknown role is dropped instead of being guessed as either side.
const roleFor = (role: string): "user" | "assistant" | null => (role === "user" ? "user" : role === "assistant" || role === "agent" ? "assistant" : null)

function toChatMessage(message: ConversationMessage): ChatMessage {
  return {
    id: message.id,
    role: roleFor(message.role) ?? "assistant",
    text: message.text,
    agent: message.agent,
    timestamp: message.timestamp,
  }
}

export async function GET() {
  const conversation = await getDefaultConversation()
  return NextResponse.json(conversation.messages.filter((m) => roleFor(m.role) !== null).map(toChatMessage))
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { messages: ChatMessage[] }
    if (!Array.isArray(body.messages)) {
      return NextResponse.json({ error: "messages array required" }, { status: 400 })
    }

    // A client list may replace user/assistant history as before, but it can neither write nor erase server-delivered
    // "agent" results: those are kept whenever the client's (possibly stale) list does not contain them.
    const existing = await getDefaultConversation()
    const sent = new Set(body.messages.map((m) => m.id))
    const keptAgent = existing.messages.filter((m) => m.role === "agent" && !sent.has(m.id))
    const normalized: ConversationMessage[] = [...body.messages.filter((m) => m.role === "user" || m.role === "assistant").map((message) => ({
      id: message.id,
      role: message.role,
      text: message.text,
      agent: message.agent,
      timestamp: message.timestamp,
    })), ...keptAgent]

    const conversation = await replaceDefaultConversationMessages(normalized)
    return NextResponse.json({ ok: true, count: conversation.messages.length })
  } catch {
    return NextResponse.json({ error: "Failed to save" }, { status: 500 })
  }
}

export async function DELETE() {
  try {
    await replaceDefaultConversationMessages([])
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: "Failed to clear" }, { status: 500 })
  }
}
