import { NextResponse } from "next/server"
import { notificationEmitter, addRecentNotification } from "@/lib/notificationEmitter"
import type { NotificationPayload } from "@/lib/notificationEmitter"
import { requireAgentToken } from "@/lib/agent-auth"
import { sendExpoPush } from "@/lib/expo-push"

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

    // Fan out to registered mobile devices via the Expo Push Service (best-effort).
    // Lockscreen payloads stay generic: no agent name, message text, or business
    // detail. The full notification is only visible after opening the app.
    const GENERIC_BODIES: Record<string, string> = {
      approval: "A run needs your approval. Open Dock to decide.",
      fail: "A run failed. Open Dock for details.",
    }
    const pushBody = GENERIC_BODIES[payload.type ?? ""] ?? "Dock activity. Open the app for details."
    sendExpoPush("Dock", pushBody, { type: payload.type, id: payload.id }).catch(() => 0)

    return NextResponse.json({ ok: true, id: payload.id })
  } catch {
    return NextResponse.json({ error: "Failed to send notification" }, { status: 500 })
  }
}
