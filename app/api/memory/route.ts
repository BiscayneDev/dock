import { NextRequest, NextResponse } from "next/server"
import { assistantContext, isUuid } from "@/lib/assistant-store"
import { forget, listDurable, type MemoryRow } from "@/lib/memory"

// Shipyard Memory for the signed-in owner: durable facts and project knowledge. Owner-only.
// Conversation-scope rows are not listed here; they feed recall and are not user-facing notes.
// The old local-file reads (WORKSPACE.memory, MEMORY.md) are gone: they do not exist on Vercel.

export interface MemoryItemView {
  id: string
  scope: "fact" | "project"
  type: string
  content: string
  projectId: string | null
  projectName: string | null
  createdAt: string
}

function view(row: MemoryRow): MemoryItemView | null {
  if (row.scope !== "fact" && row.scope !== "project") return null
  return {
    id: row.id,
    scope: row.scope,
    type: row.type,
    content: row.content,
    projectId: row.projectId,
    projectName: row.projectName ?? null,
    createdAt: row.createdAt,
  }
}

export async function GET() {
  const ctx = await assistantContext()
  if (!ctx) return NextResponse.json({ error: "Sign in to view memory" }, { status: 401 })
  try {
    const rows = await listDurable({ userId: ctx.userId, workspaceId: ctx.workspaceId })
    const items = rows.map(view).filter((v): v is MemoryItemView => v !== null)
    return NextResponse.json({ items })
  } catch {
    return NextResponse.json({ error: "Memory is unavailable right now" }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  const ctx = await assistantContext()
  if (!ctx) return NextResponse.json({ error: "Sign in to change memory" }, { status: 401 })
  const id = new URL(request.url).searchParams.get("id") ?? ""
  if (!isUuid(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 })
  try {
    const removed = await forget({ userId: ctx.userId, workspaceId: ctx.workspaceId }, id)
    if (!removed) return NextResponse.json({ error: "Not found" }, { status: 404 })
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: "Could not delete" }, { status: 500 })
  }
}
