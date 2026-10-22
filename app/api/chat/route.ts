import { NextResponse } from "next/server"
import { runtime } from "@/lib/runtime"
import { inferenceChat, resolveModel } from "@/lib/inference"
import { appendEvent, appendMessage, ensureConversation, finishRun, startRun } from "@/lib/conversations"
import { addRecentNotification, notificationEmitter } from "@/lib/notificationEmitter"
import type { NotificationPayload } from "@/lib/notificationEmitter"
import { CHIEF_RUNTIME_KEY } from "@/lib/chief-key"

function emitRunNotification(agent: string, message: string, type: NotificationPayload["type"]) {
  const payload: NotificationPayload = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    agent,
    message,
    type,
    timestamp: Date.now(),
  }
  addRecentNotification(payload)
  notificationEmitter.emit("notification", payload)
}

export async function POST(request: Request) {
  let conversationId = "main-chat"
  let agent = CHIEF_RUNTIME_KEY
  let runId: string | undefined

  try {
    const body = (await request.json()) as {
      message: string
      sessionId?: string
      conversationId?: string
      agent?: string
      taskId?: string
    }
    const { message, sessionId, taskId } = body
    conversationId = body.conversationId ?? "main-chat"
    agent = body.agent ?? CHIEF_RUNTIME_KEY

    if (!message?.trim()) {
      return NextResponse.json({ error: "Message is required" }, { status: 400 })
    }

    await ensureConversation(conversationId, {
      title: conversationId === "main-chat" ? "Main chat" : "Untitled conversation",
      agent,
      taskId,
    })

    const resolvedModel = resolveModel(agent)

    const run = await startRun(conversationId, {
      agent,
      runtime: resolvedModel ? `inference:${resolvedModel.label}` : runtime.name,
      taskId,
    })
    runId = run.id

    await appendEvent(conversationId, {
      type: "run.started",
      runId: run.id,
      agent,
      summary: `${agent} started a run via ${resolvedModel ? resolvedModel.label : runtime.name}`,
      data: { runtime: resolvedModel ? `inference:${resolvedModel.label}` : runtime.name, taskId },
    })
    emitRunNotification(agent, `${agent} started working on a task`, "start")

    await appendMessage(conversationId, {
      role: "user",
      text: message,
      agent,
      timestamp: Date.now(),
      runId: run.id,
    })

    await appendEvent(conversationId, {
      type: "message.user",
      runId: run.id,
      agent,
      summary: `User sent a message to ${agent}`,
    })

    // Inference layer first (per-agent model); fall back to the runtime pipeline
    const reply =
      (await inferenceChat({ message, agent })) ?? (await runtime.chat({ message, sessionId }))

    await appendMessage(conversationId, {
      role: "assistant",
      text: reply,
      agent,
      timestamp: Date.now(),
      runId: run.id,
    })

    await appendEvent(conversationId, {
      type: "message.assistant",
      runId: run.id,
      agent,
      summary: `${agent} replied`,
    })

    await finishRun(conversationId, run.id, { status: "completed" })
    await appendEvent(conversationId, {
      type: "run.completed",
      runId: run.id,
      agent,
      summary: `${agent} completed the run`,
    })
    emitRunNotification(agent, `${agent} finished the task`, "finish")

    return NextResponse.json({ reply, conversationId, runId: run.id })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to process message"
    if (runId) {
      await finishRun(conversationId, runId, { status: "failed", error: message }).catch(() => null)
      await appendEvent(conversationId, {
        type: "run.failed",
        runId,
        agent,
        summary: `${agent} failed the run`,
        data: { error: message },
      }).catch(() => null)
      emitRunNotification(agent, `${agent} task run failed`, "info")
    }
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
