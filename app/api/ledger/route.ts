import { NextResponse } from "next/server"
import { assistantContext, isUuid, projectInWorkspace } from "@/lib/assistant-store"
import { listLedger } from "@/lib/briefs-store"

export const dynamic = "force-dynamic"

/** The project's ledger: every proposal, approval, run and outcome, newest first. Append-only. */
export async function GET(request: Request) {
  const ctx = await assistantContext()
  if (!ctx) return NextResponse.json({ error: "Sign in required" }, { status: 401 })
  const projectId = new URL(request.url).searchParams.get("projectId")
  if (!projectId || !isUuid(projectId)) return NextResponse.json({ error: "projectId is required" }, { status: 400 })
  if (!(await projectInWorkspace(ctx, projectId))) return NextResponse.json({ error: "Project not found" }, { status: 404 })
  return NextResponse.json(await listLedger(ctx.supabase, projectId))
}
