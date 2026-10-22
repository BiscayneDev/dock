import { NextResponse } from "next/server"
import {
  CHIEF_ROLE,
  CHIEF_RUNTIME_AGENT,
  DEFAULT_CHIEF_PERSONA,
  currentUser,
  ensureWorkspace,
  loadWorkspaceState,
  sessionClient,
  validateAgentName,
} from "@/lib/tenancy"
import { VENTURE_ANSWER_STEPS, answerUpdate, loadProfile, loadRules, parseRules, ventureName } from "@/lib/onboarding-server"

export const dynamic = "force-dynamic"

async function context() {
  const supabase = await sessionClient()
  const user = await currentUser(supabase)
  if (!user) return { error: NextResponse.json({ error: "Not signed in" }, { status: 401 }) }
  const ws = await ensureWorkspace(supabase, user)
  return { supabase, workspaceId: ws.id }
}

export async function GET() {
  const ctx = await context()
  if ("error" in ctx) return ctx.error
  const state = await loadWorkspaceState(ctx.supabase, ctx.workspaceId)
  const [profile, rules] = await Promise.all([loadProfile(ctx.supabase, ctx.workspaceId), loadRules(ctx.supabase, ctx.workspaceId)])
  return NextResponse.json({ ...state, profile, rules })
}

function clean(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : ""
}

export async function POST(request: Request) {
  const ctx = await context()
  if ("error" in ctx) return ctx.error
  const { supabase, workspaceId } = ctx
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const action = typeof body?.action === "string" ? body.action : ""
  const now = new Date().toISOString()

  // One onboarding answer, saved as the user moves forward. body.step selects the question.
  if (action === "answer") {
    const step = typeof body?.step === "string" ? body.step : ""
    const result = answerUpdate(step, body ?? {})
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 })
    const { error } = await supabase
      .from("workspace_profile")
      .upsert({ workspace_id: workspaceId, ...result.update, updated_at: now }, { onConflict: "workspace_id" })
    if (error) return NextResponse.json({ error: "Could not save that answer." }, { status: 500 })
    // The goal sentence is also the workspace's building field, which the rest of the app reads.
    if (step === "goal" && typeof result.update.goal === "string") {
      await supabase.from("workspaces").update({ building: result.update.goal, updated_at: now }).eq("id", workspaceId)
    }
    return NextResponse.json({ ok: true })
  }

  // The Keep step: replaces the workspace's rule list in one go.
  if (action === "rules") {
    const { error: delErr } = await supabase.from("workspace_rules").delete().eq("workspace_id", workspaceId).is("project_id", null)
    if (delErr) return NextResponse.json({ error: "Could not save your rules." }, { status: 500 })
    if (body?.skipped !== true) {
      const parsed = parseRules(body ?? {})
      if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 })
      const { error: insErr } = await supabase
        .from("workspace_rules")
        .insert(parsed.rules.map((r) => ({ workspace_id: workspaceId, ...r })))
      if (insErr) return NextResponse.json({ error: "Could not save your rules." }, { status: 500 })
    }
    const { error } = await supabase
      .from("workspace_profile")
      .upsert({ workspace_id: workspaceId, rules_skipped: body?.skipped === true, updated_at: now }, { onConflict: "workspace_id" })
    if (error) return NextResponse.json({ error: "Could not save your rules." }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  // Venture mode: one new project with its own answers and rules, written in one request. If a later
  // insert fails, the project row is deleted and its answers and rules go with it (cascade).
  if (action === "venture") {
    const { data: chief } = await supabase.from("agents").select("id").eq("workspace_id", workspaceId).eq("kind", "chief_of_staff").maybeSingle()
    if (!chief) return NextResponse.json({ error: "Name your Chief of Staff first." }, { status: 409 })

    const steps = (body?.steps && typeof body.steps === "object" ? body.steps : {}) as Record<string, Record<string, unknown>>
    const goal = answerUpdate("goal", { text: steps.goal?.text })
    if ("error" in goal) return NextResponse.json({ error: goal.error }, { status: 400 })
    const update: Record<string, unknown> = { ...goal.update }
    for (const step of VENTURE_ANSWER_STEPS) {
      const result = answerUpdate(step, steps[step] ?? {})
      if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 })
      Object.assign(update, result.update)
    }

    const rulesBody = (body?.rules && typeof body.rules === "object" ? body.rules : {}) as Record<string, unknown>
    const rulesSkipped = rulesBody.skipped === true
    const parsed = rulesSkipped ? null : parseRules(rulesBody)
    if (parsed && "error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 })
    const rules = parsed && !("error" in parsed) ? parsed.rules : []

    const goalText = String(goal.update.goal ?? "")
    const { data: project, error: projectErr } = await supabase
      .from("projects")
      .insert({ workspace_id: workspaceId, name: ventureName(goalText), goal: goalText })
      .select("id, name")
      .single()
    if (projectErr || !project) return NextResponse.json({ error: "Could not create the venture." }, { status: 500 })
    const projectId = project.id as string
    const undo = async (message: string) => {
      await supabase.from("projects").delete().eq("id", projectId)
      return NextResponse.json({ error: message }, { status: 500 })
    }

    const { error: profileErr } = await supabase
      .from("venture_profile")
      .insert({ workspace_id: workspaceId, project_id: projectId, ...update, rules_skipped: rulesSkipped, updated_at: now })
    if (profileErr) return undo("Could not save your answers.")

    if (rules.length > 0) {
      const { error: rulesErr } = await supabase
        .from("workspace_rules")
        .insert(rules.map((r) => ({ workspace_id: workspaceId, project_id: projectId, ...r })))
      if (rulesErr) return undo("Could not save your rules.")
    }
    return NextResponse.json({ ok: true, projectId, name: project.name as string }, { status: 201 })
  }

  if (action === "check-name" || action === "chief") {
    const name = clean(body?.name, 24)
    const invalid = validateAgentName(name)
    if (invalid) return NextResponse.json({ available: false, error: invalid }, { status: 400 })

    const { data: taken } = await supabase
      .from("agents")
      .select("id")
      .eq("workspace_id", workspaceId)
      .ilike("display_name", name)
      .limit(1)
    if (taken && taken.length > 0) {
      return NextResponse.json({ available: false, error: "You already have an agent with that name. Pick another." }, { status: 409 })
    }
    if (action === "check-name") return NextResponse.json({ available: true })

    const { data: chief } = await supabase.from("agents").select("id").eq("workspace_id", workspaceId).eq("kind", "chief_of_staff").maybeSingle()
    if (chief) return NextResponse.json({ error: "Your Chief of Staff is already named." }, { status: 409 })

    const { error } = await supabase.from("agents").insert({
      workspace_id: workspaceId,
      kind: "chief_of_staff",
      display_name: name,
      role: CHIEF_ROLE,
      persona: DEFAULT_CHIEF_PERSONA,
      runtime_agent: CHIEF_RUNTIME_AGENT,
    })
    if (error) {
      // 23505 = unique violation (name race or the one-chief index).
      const code = (error as { code?: string }).code
      if (code === "23505") return NextResponse.json({ error: "That name was just taken. Pick another." }, { status: 409 })
      return NextResponse.json({ error: "Could not name your Chief of Staff." }, { status: 500 })
    }
    return NextResponse.json({ ok: true }, { status: 201 })
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 })
}
