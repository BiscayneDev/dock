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
  return NextResponse.json(state)
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

  if (action === "goals") {
    const building = clean(body?.building, 1000)
    const mainGoal = clean(body?.mainGoal, 1000)
    if (!building || !mainGoal) return NextResponse.json({ error: "Tell us what you are building and your main goal." }, { status: 400 })
    const { error } = await supabase.from("workspaces").update({ building, main_goal: mainGoal, updated_at: new Date().toISOString() }).eq("id", workspaceId)
    if (error) return NextResponse.json({ error: "Could not save goals." }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  if (action === "project") {
    const name = clean(body?.name, 80)
    const goal = clean(body?.goal, 1000)
    if (!name) return NextResponse.json({ error: "Name the project." }, { status: 400 })
    const { data: existing } = await supabase.from("projects").select("id").eq("workspace_id", workspaceId).limit(1)
    if (existing && existing.length > 0) {
      const { error } = await supabase
        .from("projects")
        .update({ name, goal, updated_at: new Date().toISOString() })
        .eq("id", existing[0].id)
      if (error) return NextResponse.json({ error: "Could not save the project." }, { status: 500 })
      return NextResponse.json({ ok: true })
    }
    const { error } = await supabase.from("projects").insert({ workspace_id: workspaceId, name, goal })
    if (error) return NextResponse.json({ error: "Could not save the project." }, { status: 500 })
    return NextResponse.json({ ok: true }, { status: 201 })
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
