import { NextResponse } from "next/server"
import { getRun } from "@/lib/conversations"

interface Context {
  params: Promise<{ id: string; runId: string }>
}

export async function GET(_: Request, context: Context) {
  const { id: conversationId, runId } = await context.params
  const payload = await getRun(conversationId, runId)
  if (!payload) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 })
  }
  const events = payload.conversation.events.filter((event) => event.runId === runId)
  const messages = payload.conversation.messages.filter((message) => message.runId === runId)
  return NextResponse.json({
    run: payload.run,
    conversation: {
      id: payload.conversation.id,
      title: payload.conversation.title,
      agent: payload.conversation.agent,
      taskId: payload.conversation.taskId,
    },
    events,
    messages,
  })
}
