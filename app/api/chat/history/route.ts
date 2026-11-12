import { NextResponse } from "next/server"
import { ConversationMessage, getDefaultConversation, replaceDefaultConversationMessages } from "@/lib/conversations"

interface ChatMessage {
  id: string
  role: "user" | "assistant"
  text: string
  agent: string
  timestamp: number
}

function toChatMessage(message: ConversationMessage): ChatMessage {
  return {
    id: message.id,
    role: message.role === "assistant" ? "assistant" : "user",
    text: message.text,
    agent: message.agent,
    timestamp: message.timestamp,
  }
}

export async function GET() {
  const conversation = await getDefaultConversation()
  return NextResponse.json(conversation.messages.map(toChatMessage))
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { messages: ChatMessage[] }
    if (!Array.isArray(body.messages)) {
      return NextResponse.json({ error: "messages array required" }, { status: 400 })
    }

    const normalized: ConversationMessage[] = body.messages.map((message) => ({
      id: message.id,
      role: message.role,
      text: message.text,
      agent: message.agent,
      timestamp: message.timestamp,
    }))

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
