"use client"

import { useCallback, useEffect, useState } from "react"

// Isolated runs (P3): when a task activated with a repo runs in its own git worktree,
// this card shows the branch and the diff the owner reviews. Agents never push or
// merge - integration is a human decision. Renders nothing for ordinary tasks.

interface WorktreeInfo {
  path: string | null
  branch: string | null
  baseRef: string
}

interface DiffInfo {
  branch: string
  baseRef: string
  aheadBy: number
  stat: string
  nameStatus: string
  commits: string
}

const REFRESH_MS = 15_000

export default function WorktreeReviewCard({ taskId }: { taskId: string }) {
  const [worktree, setWorktree] = useState<WorktreeInfo | null>(null)
  const [diff, setDiff] = useState<DiffInfo | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/worktree`, { cache: "no-store" })
      if (!res.ok) return
      const data = (await res.json()) as { worktree: WorktreeInfo | null; diff: DiffInfo | null }
      setWorktree(data.worktree)
      setDiff(data.diff)
    } catch {
      // Review surface is best-effort; the board keeps working without it.
    }
  }, [taskId])

  useEffect(() => {
    load()
    const timer = setInterval(load, REFRESH_MS)
    return () => clearInterval(timer)
  }, [load])

  if (!worktree || !worktree.branch) return null

  const changedFiles = diff?.nameStatus ? diff.nameStatus.split("\n").filter(Boolean) : []

  return (
    <div
      className="rounded-lg p-3 space-y-2 text-left"
      style={{ backgroundColor: "#0a0a0f", border: "1px solid #1a1a2e" }}
      aria-label="Isolated run review"
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-white">Isolated run</p>
        <span
          className="rounded-full px-2 py-0.5 text-[11px] font-medium"
          style={{ color: "#22c55e", background: "rgba(34,197,94,0.12)" }}
        >
          {diff ? `${diff.aheadBy} commit${diff.aheadBy === 1 ? "" : "s"}` : "no commits yet"}
        </span>
      </div>
      <p className="text-[12px] text-zinc-400">
        Branch <span className="font-mono text-zinc-200">{worktree.branch}</span> from{" "}
        <span className="font-mono text-zinc-200">{worktree.baseRef}</span>
      </p>
      {diff && changedFiles.length > 0 && (
        <>
          <pre className="max-h-28 overflow-y-auto whitespace-pre-wrap text-[11px] text-zinc-400">
            {diff.stat}
          </pre>
          <p className="text-[11px] text-zinc-500">
            Review the diff in the worktree, then merge the branch yourself. The agent does not push or merge.
          </p>
        </>
      )}
    </div>
  )
}
