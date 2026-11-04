import { NextResponse } from "next/server"
import { assistantContext } from "@/lib/assistant-store"
import { getConversation, taskConversationId } from "@/lib/conversations"
import { diffForTaskBranch } from "@/lib/isolation/worktree"

export const dynamic = "force-dynamic"

interface WorktreeEventData {
  repoPath?: unknown
  path?: unknown
  branch?: unknown
  baseRef?: unknown
  taskRef?: unknown
}

/**
 * Isolated-run review surface: GET /api/tasks/<id>/worktree returns the task's
 * worktree (from the worktree.created conversation event) plus the current diff of
 * its branch against base. Owner session only. Agents never merge: this is the
 * evidence the owner reviews before merging the task branch themselves.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await assistantContext()
  if (!ctx) return NextResponse.json({ error: "Sign in required" }, { status: 401 })
  const { id } = await params

  const conversation = await getConversation(taskConversationId(id))
  const event = conversation
    ? [...conversation.events].reverse().find((e) => e.type === "worktree.created")
    : null
  if (!event) return NextResponse.json({ worktree: null, diff: null })

  const data = (event.data ?? {}) as WorktreeEventData
  const repoPath = typeof data.repoPath === "string" ? data.repoPath : null
  const taskRef = typeof data.taskRef === "string" ? data.taskRef : null
  const baseRef = typeof data.baseRef === "string" ? data.baseRef : "main"
  const worktree = {
    path: typeof data.path === "string" ? data.path : null,
    branch: typeof data.branch === "string" ? data.branch : null,
    baseRef,
  }

  if (!repoPath || !taskRef) return NextResponse.json({ worktree, diff: null })
  try {
    const diff = await diffForTaskBranch({ repoPath, taskRef, baseRef })
    return NextResponse.json({ worktree, diff })
  } catch (err) {
    // The worktree may be gone (merged and cleaned up): report the record, not an error.
    return NextResponse.json({
      worktree,
      diff: null,
      diffError: err instanceof Error ? err.message : "diff unavailable",
    })
  }
}
