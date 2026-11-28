"use client"

import Link from "next/link"

export interface LaunchArrival {
  workspaceId: string
  goal: string
}

export function launchStorageKey(workspaceId: string): string {
  return `dock:just-launched:${workspaceId}`
}

export function writeLaunchArrival(workspaceId: string | null, goal: string): void {
  if (!workspaceId) return
  try {
    window.sessionStorage.setItem(
      launchStorageKey(workspaceId),
      JSON.stringify({ goal: goal.trim(), seen: false }),
    )
  } catch {
    // Storage blocked: the user still lands on /work without the one-time banner.
  }
}

export function clearLaunchArrival(workspaceId: string): void {
  if (!workspaceId) return
  try {
    window.sessionStorage.removeItem(launchStorageKey(workspaceId))
  } catch {
    // Ignore storage errors.
  }
}

/**
 * Reads the one-time launch state for `workspaceId`.
 * Marks `seen: true` on first mount so a browser refresh removes the key instead of
 * showing the arrival card twice, while keeping the key present until dismissed.
 */
export function consumeLaunchArrival(workspaceId: string, fallbackGoal = ""): LaunchArrival | null {
  if (!workspaceId) return null
  const key = launchStorageKey(workspaceId)
  try {
    const raw = window.sessionStorage.getItem(key)
    if (!raw) return null

    let hasGoalField = false
    let parsedGoal = ""
    let seen = false

    try {
      const parsed = JSON.parse(raw) as unknown
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const rec = parsed as { goal?: unknown; seen?: unknown }
        seen = rec.seen === true
        if ("goal" in rec && typeof rec.goal === "string") {
          hasGoalField = true
          parsedGoal = rec.goal.trim()
        }
      }
    } catch {
      // Plain string marker in sessionStorage: fall back to workspace goal if present.
    }

    if (seen) {
      window.sessionStorage.removeItem(key)
      return null
    }

    const goal = hasGoalField ? parsedGoal : fallbackGoal.trim()
    window.sessionStorage.setItem(key, JSON.stringify({ goal, seen: true }))
    return { workspaceId, goal }
  } catch {
    return null
  }
}

export function LaunchCard({
  goal,
  onDismiss,
}: {
  goal: string
  onDismiss: () => void
}) {
  const headline = goal.trim()

  return (
    <section
      aria-label="Venture live"
      data-launch-card="true"
      className="mt-8 rounded-[10px] border p-6"
      style={{
        borderColor: "var(--dock-line-2)",
        backgroundColor: "var(--dock-panel)",
        color: "var(--dock-ink)",
      }}
    >
      <div className="flex items-center justify-between gap-3">
        <span
          className="inline-flex items-center gap-2 font-mono text-[11px]"
          style={{ color: "var(--dock-ink-2)" }}
        >
          <span
            aria-hidden
            className="h-[6px] w-[6px] rounded-full"
            style={{ backgroundColor: "var(--dock-ready)" }}
          />
          Venture live
        </span>
        <button
          type="button"
          onClick={onDismiss}
          className="inline-flex min-h-[36px] items-center rounded-[8px] px-2.5 text-[12.5px] transition-colors hover:text-[var(--dock-ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/65 motion-reduce:transition-none [@media(pointer:coarse)]:min-h-[44px]"
          style={{ color: "var(--dock-ink-2)" }}
        >
          Dismiss
        </button>
      </div>

      {headline.length > 0 && (
        <h2
          className="mt-3 text-[22px] font-medium leading-[1.3] tracking-[-0.02em] [overflow-wrap:anywhere]"
          style={{ color: "var(--dock-ink)" }}
        >
          {headline}
        </h2>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2.5">
        <Link
          href="/tasks"
          className="dock-action focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/65 [@media(pointer:coarse)]:min-h-[44px]"
        >
          Add the first work item
        </Link>
        <Link
          href="/settings"
          className="inline-flex min-h-[36px] items-center justify-center rounded-[8px] border px-3 py-1.5 text-[13.5px] font-medium transition-colors hover:bg-[var(--dock-selection)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/65 motion-reduce:transition-none [@media(pointer:coarse)]:min-h-[44px]"
          style={{
            borderColor: "var(--dock-line-2)",
            color: "var(--dock-ink)",
          }}
        >
          Invite a teammate
        </Link>
        <Link
          href="/assistant"
          className="inline-flex min-h-[36px] items-center rounded-[8px] px-2.5 py-1.5 text-[13.5px] transition-colors hover:text-[var(--dock-ink)] hover:underline hover:underline-offset-[3px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/65 motion-reduce:transition-none [@media(pointer:coarse)]:min-h-[44px]"
          style={{ color: "var(--dock-ink-2)" }}
        >
          Ask the Chief of Staff
        </Link>
      </div>
    </section>
  )
}
