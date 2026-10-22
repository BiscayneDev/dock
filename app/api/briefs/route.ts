import { NextResponse } from "next/server"
import { assistantContext, isUuid, projectInWorkspace } from "@/lib/assistant-store"
import { listBriefsForProject } from "@/lib/briefs-store"

export const dynamic = "force-dynamic"

/** Briefs for one project in the signed-in owner's workspace, newest first. */
export async function GET(request: Request) {
  const ctx = await assistantContext()
  if (!ctx) return NextResponse.json({ error: "Sign in required" }, { status: 401 })
  const projectId = new URL(request.url).searchParams.get("projectId")
  if (!projectId || !isUuid(projectId)) return NextResponse.json({ error: "projectId is required" }, { status: 400 })
  if (!(await projectInWorkspace(ctx, projectId))) return NextResponse.json({ error: "Project not found" }, { status: 404 })
  return NextResponse.json(await listBriefsForProject(ctx.supabase, projectId))
}
