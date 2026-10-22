import { NextResponse } from "next/server"
import { deleteConversation, updateConversation } from "@/lib/conversations"
import {
  assistantContext,
  deleteAssistantConversation,
  getAssistantConversation,
  projectInWorkspace,
  updateAssistantConversation,
} from "@/lib/assistant-store"
import { detailForUser } from "@/lib/assistant-api"

export const dynamic = "force-dynamic"

interface Context {
  params: Promise<{ id: string }>
}

export async function GET(_: Request, context: Context) {
  const { id } = await context.params
  const detail = await detailForUser(await assistantContext(), id)
  if (!detail) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 })
  }
  return NextResponse.json(detail)
}

export async function PATCH(request: Request, context: Context) {
  try {
    const { id } = await context.params
    const body = (await request.json()) as {
      title?: string
      status?: "active" | "completed" | "failed" | "paused"
      agent?: string
      project?: string
      /** Assistant chats only: attach to a project, or null for "No project". */
      projectId?: string | null
      taskId?: string
    }
    const ctx = await assistantContext()
    const row = ctx ? await getAssistantConversation(ctx, id) : null
    if (ctx && row) {
      let projectId: string | null | undefined = undefined
      if (body.projectId !== undefined) {
        if (body.projectId === null) {
          projectId = null
        } else {
          const project = await projectInWorkspace(ctx, body.projectId)
          if (!project) return NextResponse.json({ error: "Project not found" }, { status: 400 })
          projectId = project.id
        }
      }
      const updated = await updateAssistantConversation(ctx, id, { title: body.title, projectId })
      if (!updated) return NextResponse.json({ error: "Conversation not found" }, { status: 404 })
      return NextResponse.json(await detailForUser(ctx, id))
    }
    if (body.projectId !== undefined) {
      return NextResponse.json({ error: "Older chats stay under No project. Start a new chat in the project." }, { status: 400 })
    }
    const updated = await updateConversation(id, body)
    if (!updated) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 })
    }
    return NextResponse.json(updated)
  } catch {
    return NextResponse.json({ error: "Failed to update conversation" }, { status: 400 })
  }
}

export async function DELETE(_: Request, context: Context) {
  const { id } = await context.params
  const ctx = await assistantContext()
  if (ctx && (await deleteAssistantConversation(ctx, id))) {
    await deleteConversation(id).catch(() => null)
    return NextResponse.json({ ok: true })
  }
  const deleted = await deleteConversation(id)
  if (!deleted) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 })
  }
  return NextResponse.json({ ok: true })
}
