import { NextResponse } from "next/server"
import { assistantContext, isUuid, projectInWorkspace } from "@/lib/assistant-store"
import { getProjectSpend, setProjectCap } from "@/lib/briefs-store"
import { validateCapCents } from "@/lib/briefs"

export const dynamic = "force-dynamic"

async function scoped(params: Promise<{ id: string }>) {
  const ctx = await assistantContext()
  if (!ctx) return { error: NextResponse.json({ error: "Sign in required" }, { status: 401 }) }
  const { id } = await params
  if (!isUuid(id)) return { error: NextResponse.json({ error: "Not found" }, { status: 404 }) }
  if (!(await projectInWorkspace(ctx, id))) return { error: NextResponse.json({ error: "Project not found" }, { status: 404 }) }
  return { ctx, id }
}

/** This month's cap, spend and reservations for the project. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await scoped(params)
  if ("error" in s) return s.error
  return NextResponse.json(await getProjectSpend(s.ctx.supabase, s.id, new Date()))
}

/** Owner sets or clears the project's monthly cap. Body: { capCents: number | null }. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await scoped(params)
  if ("error" in s) return s.error
  let body: { capCents?: unknown }
  try {
    body = (await request.json()) as { capCents?: unknown }
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }
  const cap = validateCapCents(body.capCents === undefined ? "missing" : body.capCents)
  if (typeof cap === "string") return NextResponse.json({ error: cap }, { status: 400 })
  await setProjectCap(s.ctx.supabase, s.id, cap)
  return NextResponse.json(await getProjectSpend(s.ctx.supabase, s.id, new Date()))
}
