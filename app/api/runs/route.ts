import { NextResponse } from "next/server"
import { assistantContext, isUuid, projectInWorkspace } from "@/lib/assistant-store"
import { enqueueRun, listEventsForRuns, listRuns } from "@/lib/queue"
import { ownerHasOnlineDevice } from "@/lib/devices"
import { buildModel, parseModelRef, resolveModelRef, listConfiguredProviders } from "@/lib/inference"
import { createShipyardCapture } from "@/lib/inference/shipyard-capture"
import { RUN_TARGETS, type RunTarget } from "@/lib/task-runs"
import { CHIEF_RUNTIME_KEY } from "@/lib/chief-key"

export const dynamic = "force-dynamic"

const AGENT_KEY = /^[a-z0-9_-]{1,64}$/
const MAX_PROMPT = 8000
const DEFAULT_BUDGET_CENTS = 100

function maxBudgetCents(): number {
  const raw = Number(process.env.WORKER_MAX_BUDGET_CENTS)
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 2000
}

/** Owner's background runs with their events, newest first. Signed out = 401. */
export async function GET() {
  const ctx = await assistantContext()
  if (!ctx) return NextResponse.json({ error: "Sign in required" }, { status: 401 })
  const runs = await listRuns(ctx.supabase, 50)
  const events = await listEventsForRuns(
    ctx.supabase,
    runs.map((r) => r.id),
  )
  return NextResponse.json({
    homeOnline: await ownerHasOnlineDevice(ctx.supabase),
    runs: runs.map((run) => ({
      ...run,
      events: events.filter((e) => e.runId === run.id),
    })),
  })
}

/** Queue a background run for the signed-in owner. Target 'cloud' only in P2. */
export async function POST(request: Request) {
  const ctx = await assistantContext()
  if (!ctx) return NextResponse.json({ error: "Sign in required" }, { status: 401 })

  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : ""
  if (!prompt || prompt.length > MAX_PROMPT) {
    return NextResponse.json({ error: `prompt is required (max ${MAX_PROMPT} chars)` }, { status: 400 })
  }

  const target = (body.target ?? "cloud") as RunTarget
  if (!(RUN_TARGETS as readonly string[]).includes(target)) {
    return NextResponse.json({ error: "Unknown target" }, { status: 400 })
  }
  if (target === "sandbox") {
    return NextResponse.json({ error: "target 'sandbox' is not available yet" }, { status: 400 })
  }

  const budget = body.budget_cents === undefined ? DEFAULT_BUDGET_CENTS : body.budget_cents
  if (typeof budget !== "number" || !Number.isInteger(budget) || budget < 1 || budget > maxBudgetCents()) {
    return NextResponse.json({ error: `budget_cents must be 1..${maxBudgetCents()}` }, { status: 400 })
  }

  const agentKey = typeof body.agent === "string" ? body.agent : CHIEF_RUNTIME_KEY
  if (!AGENT_KEY.test(agentKey)) return NextResponse.json({ error: "Invalid agent" }, { status: 400 })

  let agentId: string | null = null
  if (body.agent_id !== undefined && body.agent_id !== null) {
    if (typeof body.agent_id !== "string" || !isUuid(body.agent_id)) {
      return NextResponse.json({ error: "Invalid agent_id" }, { status: 400 })
    }
    const { data } = await ctx.supabase
      .from("agents")
      .select("id")
      .eq("id", body.agent_id)
      .eq("workspace_id", ctx.workspaceId)
      .maybeSingle()
    if (!data) return NextResponse.json({ error: "Agent not found" }, { status: 400 })
    agentId = body.agent_id
  }

  let projectId: string | null = null
  if (body.project_id !== undefined && body.project_id !== null) {
    const project = typeof body.project_id === "string" ? await projectInWorkspace(ctx, body.project_id) : null
    if (!project) return NextResponse.json({ error: "Project not found" }, { status: 400 })
    projectId = project.id
  }

  // The thread the run came from. Owner-checked, so a run can only be tied to the caller's own conversation.
  let conversationId: string | null = null
  if (body.conversation_id !== undefined && body.conversation_id !== null) {
    if (typeof body.conversation_id !== "string" || !isUuid(body.conversation_id)) {
      return NextResponse.json({ error: "Invalid conversation_id" }, { status: 400 })
    }
    const { data } = await ctx.supabase
      .from("conversations")
      .select("id")
      .eq("id", body.conversation_id)
      .eq("workspace_id", ctx.workspaceId)
      .maybeSingle()
    if (!data) return NextResponse.json({ error: "Conversation not found" }, { status: 400 })
    conversationId = body.conversation_id
  }

  // The model is recorded on the run at enqueue time. Explicit model must be a configured provider.
  let model: string | null = null
  let modelReason: string | null = null
  if (typeof body.model === "string" && body.model.trim()) {
    const ref = body.model.trim()
    const parsed = parseModelRef(ref)
    const ok = parsed !== null && listConfiguredProviders().some((p) => p.provider === parsed.provider && p.configured)
    if (!ok || !buildModel(ref, createShipyardCapture())) {
      return NextResponse.json({ error: "Model provider is not configured on this server" }, { status: 400 })
    }
    model = ref
    modelReason = "Chosen in the composer for this message"
  } else {
    model = resolveModelRef(agentKey)
    modelReason = "Agent default (no model chosen in the composer)"
  }
  if (!model) return NextResponse.json({ error: "No model configured for this agent" }, { status: 400 })

  try {
    const run = await enqueueRun(ctx.supabase, {
      workspaceId: ctx.workspaceId,
      ownerId: ctx.userId,
      projectId,
      agentId,
      agentKey,
      target,
      prompt,
      model,
      budgetCents: budget,
      conversationId,
      modelReason,
    })
    return NextResponse.json({ id: run.id, status: run.status, budgetCents: run.budgetCents }, { status: 201 })
  } catch {
    return NextResponse.json({ error: "Failed to queue run" }, { status: 500 })
  }
}
