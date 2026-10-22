import { createUIMessageStream, createUIMessageStreamResponse } from "ai"
import { randomUUID } from "crypto"
import { after } from "next/server"
import { runtime } from "@/lib/runtime"
import {
  buildModel,
  collectRunTelemetry,
  inferenceStream,
  listConfiguredProviders,
  parseModelRef,
  resolveModel,
  type ResolvedModel,
} from "@/lib/inference"
import { appendEvent, appendMessage, ensureConversation, finishRun, startRun } from "@/lib/conversations"
import {
  appendAssistantMessage,
  assistantContext,
  getAssistantConversation,
  listAssistantMessages,
  type AssistantContext,
} from "@/lib/assistant-store"
import { createShipyardCapture } from "@/lib/inference/shipyard-capture"
import { CHIEF_RUNTIME_AGENT } from "@/lib/tenancy"
import { chiefSystemPrompt } from "@/lib/onboarding-server"
import { recordTurn } from "@/lib/memory"
import { buildProtocolPrompt, MAKE_TASK_INSTRUCTION, parseBriefBlocks, parseMention, pickChief } from "@/lib/briefs"
import { createBriefs, loadRoster, maxBriefBudgetCents } from "@/lib/briefs-store"

const HISTORY_TURNS = 20
const HISTORY_CHARS = 12000
// "Make this a task" reads the whole thread before the chief decides what the task is.
const TASK_HISTORY_TURNS = 400
const TASK_HISTORY_CHARS = 150000

/** Recent turns of an assistant chat, oldest first, within a fixed budget. Fails open to no history. */
async function priorTurns(
  ctx: AssistantContext,
  conversationId: string,
  limits: { turns: number; chars: number } = { turns: HISTORY_TURNS, chars: HISTORY_CHARS },
): Promise<Array<{ role: "user" | "assistant"; content: string }>> {
  const messages = await listAssistantMessages(ctx, conversationId, 1000).catch(() => [])
  const turns = messages
    .filter((m) => (m.role === "user" || m.role === "assistant") && m.content.trim().length > 0)
    .slice(-limits.turns)
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }))
  const kept: typeof turns = []
  let total = 0
  for (let i = turns.length - 1; i >= 0; i--) {
    total += turns[i].content.length
    if (total > limits.chars) break
    kept.unshift(turns[i])
  }
  return kept
}


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
    /** Set by "Make this a task": the chief reads the whole thread and decides the task. */
    makeTask?: boolean
  }

  const conversationId = body.conversationId ?? "main-chat"
  let agent = body.agent ?? ""
  const sessionId = body.sessionId
  const taskId = body.taskId
  const messages = Array.isArray(body.messages) ? body.messages : []
  const latestUserMessage = [...messages].reverse().find((message) => message.role === "user")
  const prompt = extractText(latestUserMessage)

  if (!prompt.trim()) {
    return new Response("Message is required", { status: 400 })
  }

  // Per-call cost capture for Shipyard models (telemetry only; see shipyard-capture.ts).
  const capture = createShipyardCapture()

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
    override = buildModel(ref, capture)
    if (!override) {
      return Response.json({ error: "Model could not be built" }, { status: 400 })
    }
  }

  // Assistant chats live in Supabase and carry a project. Older file chats keep the file path, with no project.
  const ctx = await assistantContext()
  const roster = ctx ? await loadRoster(ctx.supabase, ctx.workspaceId).catch(() => []) : []
  // No agent chosen: the workspace's chief answers. The runtime constant only covers signed-out, file-backed chats.
  const chiefAgent = pickChief(roster)?.key ?? CHIEF_RUNTIME_AGENT
  if (!agent) agent = chiefAgent

  await ensureConversation(conversationId, {
    title: conversationId === "main-chat" ? "Main chat" : "Untitled conversation",
    agent,
    taskId,
  })

  const assistantChat = ctx ? await getAssistantConversation(ctx, conversationId) : null
  const projectId = assistantChat?.projectId ?? null
  const makeTask = body.makeTask === true
  const history = assistantChat && ctx
    ? await priorTurns(ctx, conversationId, makeTask ? { turns: TASK_HISTORY_TURNS, chars: TASK_HISTORY_CHARS } : undefined)
    : []

  // @mention routes this turn to a roster agent. The mention is stripped from what the model sees;
  // the thread keeps the owner's original text. Mentions never approve or spawn work by themselves.
  let modelPrompt = prompt
  if (assistantChat && ctx && projectId) {
    const mention = parseMention(prompt, roster)
    if (mention.agentKey) {
      agent = mention.agentKey
      modelPrompt = mention.text || prompt
    }
  }

  const resolvedModel = override ?? resolveModel(agent, capture)

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
    data: { runtime: resolvedModel ? `inference:${resolvedModel.label}` : runtime.name, taskId, projectId },
  })

  if (assistantChat && ctx) {
    await appendAssistantMessage(ctx, conversationId, {
      role: "user",
      content: prompt,
      agent,
      meta: { runId: run.id, projectId },
    })
  } else {
    await appendMessage(conversationId, {
      role: "user",
      text: prompt,
      agent,
      timestamp: Date.now(),
      runId: run.id,
    })
  }

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

        // Chief of Staff only: saved onboarding profile and enabled rules (null when none saved).
        // Project chats teach every agent the task protocol: tasks are proposed for approval, never started from chat.
        const base = agent === chiefAgent ? await chiefSystemPrompt(projectId, prompt) : null
        const system = projectId
          ? [base, buildProtocolPrompt(roster), makeTask ? MAKE_TASK_INSTRUCTION : null].filter(Boolean).join("\n\n")
          : base
        const result = await inferenceStream({
          message: modelPrompt,
          agent,
          override: resolvedModel,
          system: system ?? undefined,
          history: history.length > 0 ? history : undefined,
        })
        let telemetry: ReturnType<typeof collectRunTelemetry> = null
        if (result) {
          // Real token streaming through the inference layer
          for await (const delta of result.textStream) {
            reply += delta
            writer.write({ type: "text-delta", id: textId, delta })
          }
          // Per-call usage from the SDK; cost from the Shipyard capture. Fail open.
          try {
            telemetry = collectRunTelemetry(await result.steps, capture)
          } catch {
            telemetry = null
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

        if (assistantChat && ctx) {
          // Task blocks (fenced as brief) become proposals (state: proposed). They are stripped from the stored text and shown as task cards.
          let storedText = reply
          let briefIds: string[] = []
          if (projectId) {
            const parsed = parseBriefBlocks(reply, maxBriefBudgetCents())
            storedText = parsed.text
            if (parsed.proposals.length > 0) {
              // Proposals may only name roster agents; anything else falls back to the chief.
              const known = new Set(roster.map((a) => a.key))
              const chief = pickChief(roster)?.key ?? agent
              // Unknown agents fall back to the chief; a proposal never names an agent outside the roster.
              const resolve = (key: string | null) => (key && known.has(key) ? key : chief)
              const proposals = parsed.proposals.map((p) => ({
                ...p,
                agentKey: resolve(p.agentKey),
                assignments: p.assignments.map((a) => ({ ...a, agentKey: resolve(a.agentKey) })),
              }))
              const briefs = await createBriefs(
                ctx.supabase,
                { workspaceId: ctx.workspaceId, ownerId: ctx.userId },
                { projectId, conversationId, proposals, defaultAgentKey: chief },
              ).catch((error) => {
                console.error("[briefs] could not store proposals", error)
                return []
              })
              briefIds = briefs.map((b) => b.id)
            }
          }
          await appendAssistantMessage(ctx, conversationId, {
            role: "assistant",
            content: storedText,
            agent,
            meta: { runId: run.id, projectId, ...(briefIds.length > 0 ? { briefIds } : {}) },
          })
          // Shipyard Memory: conversation scope + durable facts, after the reply. Never blocks it.
          const turnOwner = { userId: ctx.userId, workspaceId: ctx.workspaceId }
          const turn = { userText: prompt, assistantText: storedText }
          try {
            after(() => recordTurn(turnOwner, conversationId, projectId, turn))
          } catch {
            void recordTurn(turnOwner, conversationId, projectId, turn)
          }
        } else {
          await appendMessage(conversationId, {
            role: "assistant",
            text: reply,
            agent,
            timestamp: Date.now(),
            runId: run.id,
          })
        }
        await appendEvent(conversationId, {
          type: "message.assistant",
          runId: run.id,
          agent,
          summary: `${agent} replied in streamed chat`,
        })
        await finishRun(conversationId, run.id, { status: "completed", telemetry: telemetry ?? undefined })
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
