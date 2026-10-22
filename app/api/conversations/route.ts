import { NextResponse } from "next/server"
import { createConversation } from "@/lib/conversations"
import { assistantContext, createAssistantConversation, getAssistantConversation, projectInWorkspace } from "@/lib/assistant-store"
import { chiefKey, ensureCentralConversation } from "@/lib/briefs-store"
import { detailForUser, listForUser } from "@/lib/assistant-api"

export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  const url = new URL(request.url)
  const query = url.searchParams.get("q") ?? undefined
  const conversations = await listForUser(await assistantContext(), query)
  return NextResponse.json(conversations)
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      title?: string
      agent?: string
      project?: string
      projectId?: string | null
      taskId?: string
    }
    const ctx = await assistantContext()
    if (ctx && !body.taskId) {
      let projectId: string | null = null
      if (body.projectId) {
        const project = await projectInWorkspace(ctx, body.projectId)
        if (!project) return NextResponse.json({ error: "Project not found" }, { status: 400 })
        projectId = project.id
      }
      // A project has one central thread. Opening a project's conversation returns it, never a second one.
      if (projectId) {
        const agentKey = await chiefKey(ctx.supabase, ctx.workspaceId)
        if (!agentKey) return NextResponse.json({ error: "No chief of staff configured" }, { status: 409 })
        const central = await ensureCentralConversation(ctx.supabase, { workspaceId: ctx.workspaceId, ownerId: ctx.userId }, projectId, agentKey)
        const detail = await getAssistantConversation(ctx, central.id)
        if (detail) return NextResponse.json(detail, { status: 200 })
      }
      const created = await createAssistantConversation(ctx, { title: body.title, agent: body.agent, projectId })
      return NextResponse.json(created, { status: 201 })
    }
    const conversation = await createConversation(body)
    return NextResponse.json(conversation, { status: 201 })
  } catch {
    return NextResponse.json({ error: "Failed to create conversation" }, { status: 400 })
  }
}
