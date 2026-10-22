import { NextResponse } from "next/server"
import { notificationEmitter, addRecentNotification } from "@/lib/notificationEmitter"
import type { NotificationPayload } from "@/lib/notificationEmitter"
import { requireAgentToken } from "@/lib/agent-auth"

export async function POST(request: Request) {
  const denied = requireAgentToken(request)
  if (denied) return denied

  try {
    const body = await request.json() as { agent?: string; message?: string; type?: string }

    if (!body.agent || !body.message) {
      return NextResponse.json({ error: "agent and message required" }, { status: 400 })
    }

    const payload: NotificationPayload = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      agent: body.agent,
      message: body.message,
      type: (body.type as NotificationPayload["type"]) || "info",
      timestamp: Date.now(),
    }

    // Store in recent
    addRecentNotification(payload)

    // Broadcast to SSE listeners
    notificationEmitter.emit("notification", payload)

    return NextResponse.json({ ok: true, id: payload.id })
  } catch {
    return NextResponse.json({ error: "Failed to send notification" }, { status: 500 })
  }
}
