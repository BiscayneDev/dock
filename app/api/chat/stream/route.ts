import { createUIMessageStream, createUIMessageStreamResponse } from "ai"
import { randomUUID } from "crypto"
import { runtime } from "@/lib/runtime"
import {
  buildModel,
  inferenceStream,
  listConfiguredProviders,
  parseModelRef,
  resolveModel,
  type ResolvedModel,
} from "@/lib/inference"
import { appendEvent, appendMessage, ensureConversation, finishRun, startRun } from "@/lib/conversations"

interface IncomingMessage {
  id?: string
  role?: string
  content?: string
  parts?: Array<{ type?: string; text?: string }>
}

function extractText(message: IncomingMessage | undefined): string {
  if (!message) return ""
  if (typeof message.content === "string") return message.content
  if (Array.isArray(message.parts)) {
    return message.parts
      .filter((part) => part.type === "text" && typeof part.text === "string")
      .map((part) => part.text)
      .join("\n")
  }
  return ""
}

export async function POST(request: Request) {
  const body = (await request.json()) as {
    messages?: IncomingMessage[]
    conversationId?: string
    agent?: string
    sessionId?: string
    taskId?: string
    /** Optional per-message model, `provider/model-id`. Absent = agent default. */
    model?: unknown
  }

  const conversationId = body.conversationId ?? "main-chat"
  const agent = body.agent ?? "vic"
  const sessionId = body.sessionId
  const taskId = body.taskId
  const messages = Array.isArray(body.messages) ? body.messages : []
  const latestUserMessage = [...messages].reverse().find((message) => message.role === "user")
  const prompt = extractText(latestUserMessage)

  if (!prompt.trim()) {
    return new Response("Message is required", { status: 400 })
  }

  // Per-message model override. Absent keeps the agent default exactly as before.
  // Fail closed: the provider must be configured on this server and the model must build.
  let override: ResolvedModel | null = null
  if (body.model !== undefined && body.model !== null) {
    const ref = typeof body.model === "string" ? body.model.trim() : ""
    const parsed = ref ? parseModelRef(ref) : null
    const providerOk =
      parsed !== null &&
      listConfiguredProviders().some((p) => p.provider === parsed.provider && p.configured)
    if (!providerOk) {
      return Response.json({ error: "Model provider is not configured on this server" }, { status: 400 })
    }
    override = buildModel(ref)
    if (!override) {
      return Response.json({ error: "Model could not be built" }, { status: 400 })
    }
  }

  await ensureConversation(conversationId, {
    title: conversationId === "main-chat" ? "Main chat" : "Untitled conversation",
    agent,
    taskId,
  })

  const resolvedModel = override ?? resolveModel(agent)

  const run = await startRun(conversationId, {
    agent,
    runtime: resolvedModel ? `inference:${resolvedModel.label}` : runtime.name,
    taskId,
  })

  await appendEvent(conversationId, {
    type: "run.started",
    runId: run.id,
    agent,
    summary: `${agent} started a streamed run via ${resolvedModel ? resolvedModel.label : runtime.name}`,
    data: { runtime: resolvedModel ? `inference:${resolvedModel.label}` : runtime.name, taskId },
  })

  await appendMessage(conversationId, {
    role: "user",
    text: prompt,
    agent,
    timestamp: Date.now(),
    runId: run.id,
  })

  await appendEvent(conversationId, {
    type: "message.user",
    runId: run.id,
    agent,
    summary: `User sent a streamed message to ${agent}`,
  })

  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      const textId = randomUUID()
      writer.write({ type: "start-step" })
      writer.write({ type: "text-start", id: textId })

      try {
        let reply = ""

        const textStream = await inferenceStream({ message: prompt, agent, override })
        if (textStream) {
          // Real token streaming through the inference layer
          for await (const delta of textStream) {
            reply += delta
            writer.write({ type: "text-delta", id: textId, delta })
          }
        } else {
          // Fall back to the AgentRuntime pipeline (chunked fake streaming)
          reply = await runtime.chat({ message: prompt, sessionId })
          const chunks = reply.match(/.{1,24}(\s|$)/g) ?? [reply]

          for (const chunk of chunks) {
            writer.write({ type: "text-delta", id: textId, delta: chunk })
          }
        }

        writer.write({ type: "text-end", id: textId })
        writer.write({ type: "finish-step" })

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
          summary: `${agent} replied in streamed chat`,
        })
        await finishRun(conversationId, run.id, { status: "completed" })
        await appendEvent(conversationId, {
          type: "run.completed",
          runId: run.id,
          agent,
          summary: `${agent} completed the streamed run`,
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to process message"
        await finishRun(conversationId, run.id, { status: "failed", error: message }).catch(() => null)
        await appendEvent(conversationId, {
          type: "run.failed",
          runId: run.id,
          agent,
          summary: `${agent} failed the streamed run`,
          data: { error: message },
        }).catch(() => null)
        throw error
      }
    },
    onError: (error) => (error instanceof Error ? error.message : "Something went wrong"),
  })

  return createUIMessageStreamResponse({ stream })
}
