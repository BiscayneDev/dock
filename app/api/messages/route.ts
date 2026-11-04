import { NextResponse } from "next/server"
import { requireMobileOrOwner } from "@/lib/mobile-auth-server"
import { readFile, writeFile, mkdir } from "fs/promises"
import { join, dirname } from "path"
import { randomUUID } from "crypto"
import { appendEvent, appendMessage, ensureTaskConversation, listAllEvents } from "@/lib/conversations"

export interface AgentMessage {
  id: string
  from: string
  to: string
  content: string
  type: "delegation" | "report" | "question" | "alert" | "handoff"
  taskId?: string
  taskTitle?: string
  timestamp: string
  read: boolean
}

// DOCK_DATA_DIR overrides the data dir for the local e2e harness (fictional fixtures).
const DATA_PATH = join(process.env.DOCK_DATA_DIR ?? join(process.cwd(), "data"), "messages.json")
const MAX_MESSAGES = 500

async function readMessages(): Promise<AgentMessage[]> {
  try {
    const raw = await readFile(DATA_PATH, "utf-8")
    return JSON.parse(raw) as AgentMessage[]
  } catch {
    return []
  }
}

async function writeMessages(msgs: AgentMessage[]): Promise<void> {
  await mkdir(dirname(DATA_PATH), { recursive: true })
  const trimmed = msgs
    .sort((a, b) => (b.timestamp > a.timestamp ? 1 : -1))
    .slice(0, MAX_MESSAGES)
  await writeFile(DATA_PATH, JSON.stringify(trimmed, null, 2), "utf-8")
}

function eventTypeToMessageType(type: string): AgentMessage["type"] {
  if (type === "delegation") return "delegation"
  if (type === "question") return "question"
  if (type === "alert") return "alert"
  if (type === "handoff") return "handoff"
  return "report"
}

function parseAgentMessage(summary: string, data?: Record<string, unknown>): { from: string; to: string; content: string } {
  const from = typeof data?.from === "string" ? data.from : "unknown"
  const to = typeof data?.to === "string" ? data.to : "unknown"
  const contentFromData = typeof data?.content === "string" ? data.content : ""
  if (contentFromData) return { from, to, content: contentFromData }

  const marker = ": "
  const idx = summary.indexOf(marker)
  const content = idx >= 0 ? summary.slice(idx + marker.length) : summary
  return { from, to, content }
}

export async function GET(request: Request) {
  const denied = await requireMobileOrOwner(request, "messages:read")
  if (denied) return denied
  const url = new URL(request.url)
  const agent = url.searchParams.get("agent")
  const canonical = url.searchParams.get("canonical")
  const limitParam = url.searchParams.get("limit")
  const limit = limitParam ? Math.min(Math.max(1, parseInt(limitParam, 10) || 50), 200) : 50

  if (canonical === "1") {
    const events = await listAllEvents(limit * 4)
    let messages = events
      .filter((event) => event.type === "message.agent")
      .map((event) => {
        const data = (event.data ?? {}) as Record<string, unknown>
        const parsed = parseAgentMessage(event.summary, data)
        return {
          id: event.id,
          from: parsed.from,
          to: parsed.to,
          content: parsed.content,
          type: eventTypeToMessageType(typeof data.type === "string" ? data.type : "report"),
          taskId: typeof data.taskId === "string" ? data.taskId : undefined,
          taskTitle: typeof data.taskTitle === "string" ? data.taskTitle : undefined,
          timestamp: event.timestamp,
          read: true,
        } satisfies AgentMessage
      })

    if (agent) {
      messages = messages.filter((message) => message.from === agent || message.to === agent)
    }

    return NextResponse.json(messages.slice(0, limit))
  }

  let messages = await readMessages()
  if (agent) {
    messages = messages.filter((m) => m.from === agent || m.to === agent)
  }

  const sorted = messages
    .sort((a, b) => (b.timestamp > a.timestamp ? 1 : -1))
    .slice(0, limit)

  return NextResponse.json(sorted)
}

export async function POST(request: Request) {
  const denied = await requireMobileOrOwner(request, "messages:write")
  if (denied) return denied
  try {
    const body = (await request.json()) as Partial<AgentMessage>

    if (!body.from || !body.to || !body.content) {
      return NextResponse.json(
        { error: "from, to, and content are required" },
        { status: 400 }
      )
    }

    const msg: AgentMessage = {
      id: body.id ?? randomUUID(),
      from: body.from,
      to: body.to,
      content: body.content,
      type: body.type ?? "report",
      taskId: body.taskId,
      taskTitle: body.taskTitle,
      timestamp: body.timestamp ?? new Date().toISOString(),
      read: false,
    }

    const existing = await readMessages()
    existing.push(msg)
    await writeMessages(existing)

    if (msg.taskId && msg.taskTitle) {
      const conversation = await ensureTaskConversation({
        taskId: msg.taskId,
        title: msg.taskTitle,
        agent: msg.to,
      })
      await appendMessage(conversation.id, {
        id: msg.id,
        role: "agent",
        text: `${msg.from} → ${msg.to}: ${msg.content}`,
        agent: msg.to,
        timestamp: new Date(msg.timestamp).getTime(),
      })
      await appendEvent(conversation.id, {
        type: "message.agent",
        agent: msg.to,
        summary: `${msg.from} → ${msg.to}: ${msg.content}`,
        timestamp: msg.timestamp,
        data: {
          from: msg.from,
          to: msg.to,
          content: msg.content,
          type: msg.type,
          taskId: msg.taskId,
          taskTitle: msg.taskTitle,
        },
      })
    }

    return NextResponse.json(msg, { status: 201 })
  } catch {
    return NextResponse.json({ error: "Failed to send message" }, { status: 500 })
  }
}
