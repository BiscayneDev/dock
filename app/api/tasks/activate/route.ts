import { NextResponse } from "next/server"
import { MC_URL } from "@/lib/config"
import { runtime } from "@/lib/runtime"
import { appendEvent, ensureTaskConversation, updateConversation } from "@/lib/conversations"
import { enrichTaskBrief } from "@/lib/task-enrichment"
import { CHIEF_RUNTIME_KEY } from "@/lib/chief-key"
import { assistantContext } from "@/lib/assistant-store"
import { agentTokenAuthorized } from "@/lib/agent-auth"
import { mobileTokenAuthorized } from "@/lib/mobile-auth-server"
import { mobileTokenHas } from "@/lib/mobile-auth"
import { createTaskWorktree, removeTaskWorktree, isValidTaskRef, assertValidBaseRef } from "@/lib/isolation/worktree"
import { assertRepoRegistered } from "@/lib/isolation/registered-repos"

interface BudgetCheckResult {
  allowed: boolean
  agentName?: string
  spentUsd: number
  budgetUsd: number
  percentUsed: number
  warning: string | null
}

const AGENT_MAP: Record<string, string> = {
  builder: "⚡ Builder",
  scout: "🔭 Scout",
  "deal-flow": "🤝 Deal Flow",
  baron: "🏦 Baron",
  [CHIEF_RUNTIME_KEY]: "🧭 Chief of staff",
  unassigned: "unassigned",
}

function buildBrief(taskId: string, title: string, description: string | undefined, assignee: string, priority: string, worktree: { path: string; branch: string; baseRef: string } | null) {
  return [
    `🎯 [TASK ACTIVATED]`,
    ``,
    `Title: ${title}`,
    description ? `Notes: ${description}` : `Notes: (none)`,
    `Priority: ${priority || "medium"}`,
    `Suggested agent: ${AGENT_MAP[assignee] || "unassigned"}`,
    `Task ID: ${taskId}`,
    ``,
    `As Chief of Staff:`,
    `1. Enrich this into a proper brief`,
    `2. Delegate to the right agent (pass them the Task ID: ${taskId})`,
    ...(worktree
      ? [
          `3. ISOLATION (hard requirement): all file work for this task happens ONLY inside the git worktree at ${worktree.path} on branch ${worktree.branch} (created from ${worktree.baseRef}). Do not read or edit any sibling directory, do not switch branches, do not push, do not merge - a human reviews the diff and merges.`,
        ]
      : []),
    `3. Agent must call these when done:`,
    `   curl -s -X PATCH ${MC_URL}/api/tasks/${taskId} -H "Content-Type: application/json" -d '{"column":"done","description":"✅ summary"}'`,
    `   curl -s -X POST ${MC_URL}/api/notify -H "Content-Type: application/json" -H "x-dock-agent-token: $DOCK_AGENT_TOKEN" -d '{"agent":"[name]","message":"✅ Done: ${title}","type":"finish"}'`,
    `   curl -s -X POST ${MC_URL}/api/activity -H "Content-Type: application/json" -d '{"taskId":"${taskId}","taskTitle":"${title}","agent":"[name]","action":"completed","summary":"..."}'`,
    ``,
    `Do not ask for clarification — act now.`,
  ].join("\n")
}

export async function POST(request: Request) {
  try {
    const { taskId, title, description, assignee, priority, repoPath, baseRef } = await request.json()
    if (!taskId || !title) {
      return NextResponse.json({ error: "taskId and title required" }, { status: 400 })
    }

    // Every activation launches a runtime and may spend inference: it always
    // requires owner session, agent token, or a mobile credential with the
    // tasks:activate capability. Anonymous activation is never allowed, with
    // or without an isolated worktree.
    const authed =
      (await assistantContext()) !== null ||
      agentTokenAuthorized(request) ||
      ((await mobileTokenAuthorized(request)) && mobileTokenHas("tasks:activate"))
    if (!authed) {
      return NextResponse.json({ error: "Sign in required" }, { status: 401 })
    }

    // Isolated runs (P3): when the caller asks for a worktree, the task's agent works only in a
    // per-task git worktree + branch. Creating worktrees runs git on local paths, so unlike the
    // plain activation above it requires an owner session or the agent token - never anonymous.
    // Auth alone does not authorize an arbitrary host path: the repo must be one the owner
    // registered (POST /api/repos, owner session only; tokens cannot register), and baseRef is
    // strictly validated before it reaches a git command line.
    let worktree: { repoPath: string; path: string; branch: string; baseRef: string } | null = null
    if (typeof repoPath === "string" && repoPath.trim()) {
      if (!isValidTaskRef(String(taskId))) {
        return NextResponse.json({ error: "taskId is not a valid task ref for isolation" }, { status: 400 })
      }
      let registeredRepo: string
      try {
        registeredRepo = await assertRepoRegistered(repoPath.trim())
        if (typeof baseRef === "string" && baseRef.trim()) assertValidBaseRef(baseRef.trim())
      } catch (err) {
        return NextResponse.json(
          { error: err instanceof Error ? err.message : "repo not allowed" },
          { status: 403 },
        )
      }
      try {
        worktree = await createTaskWorktree({
          repoPath: registeredRepo,
          taskRef: String(taskId),
          baseRef: typeof baseRef === "string" && baseRef.trim() ? baseRef.trim() : undefined,
        })
      } catch (err) {
        return NextResponse.json(
          { error: `Could not create task worktree: ${err instanceof Error ? err.message : "unknown"}` },
          { status: 400 },
        )
      }
      // Hard isolation is a launch requirement, not a preference. The configured
      // runtime must confine the agent to the worktree itself; a worktree path
      // in a prompt is an instruction the agent can ignore. When the runtime
      // cannot enforce, fail closed: remove the worktree and refuse the launch
      // rather than silently running unconfined.
      if (!runtime.enforcesWorktreeIsolation) {
        await removeTaskWorktree({ repoPath: registeredRepo, taskRef: String(taskId), deleteBranch: true }).catch(() => null)
        return NextResponse.json(
          {
            error: `Isolated runs are not available: the '${runtime.id}' runtime cannot confine an agent to a task worktree. ` +
              "No unconfined launch was started. Use a runtime with enforcement (container/sandbox) for coding launches.",
            code: "isolation_not_enforceable",
          },
          { status: 501 },
        )
      }
    }

    const enrichment = await enrichTaskBrief({
      title,
      description,
      priority: priority || "medium",
      assignee: (assignee || "unassigned") as any,
      tags: [],
    })

    const conversation = await ensureTaskConversation({
      taskId,
      title: enrichment.enrichedTitle,
      agent: assignee || CHIEF_RUNTIME_KEY,
    })

    await updateConversation(conversation.id, {
      title,
      taskId,
      agent: assignee || conversation.agent,
      status: "active",
    })
    await appendEvent(conversation.id, {
      type: "task.linked",
      agent: assignee || CHIEF_RUNTIME_KEY,
      summary: `Task ${title} linked to conversation`,
      data: { taskId, title, priority, assignee },
    })
    await appendEvent(conversation.id, {
      type: "run.started",
      agent: assignee || CHIEF_RUNTIME_KEY,
      summary: `Activation started for ${title}`,
      data: { taskId, title, priority, assignee, status: "in-progress" },
    })

    const origin = new URL(request.url).origin
    await fetch(`${origin}/api/activity`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        taskId,
        taskTitle: title,
        agent: assignee || CHIEF_RUNTIME_KEY,
        action: "started",
        summary: `Activated: ${title}`,
      }),
    }).catch(() => null)

    if (worktree) {
      await appendEvent(conversation.id, {
        type: "worktree.created",
        agent: assignee || CHIEF_RUNTIME_KEY,
        summary: `Isolated worktree ${worktree.branch} for ${title}`,
        data: {
          taskId,
          taskRef: String(taskId),
          repoPath: worktree.repoPath,
          path: worktree.path,
          branch: worktree.branch,
          baseRef: worktree.baseRef,
        },
      })
    }

    const message = buildBrief(taskId, enrichment.enrichedTitle, enrichment.enrichedDescription, assignee || "unassigned", priority, worktree)
    let budgetWarning: { warning: string; percentUsed: number } | null = null

    if (assignee && assignee !== "unassigned") {
      try {
        const origin = new URL(request.url).origin
        const budgetRes = await fetch(`${origin}/api/company/budgets/check?agent=${encodeURIComponent(assignee)}`)
        const budget = (await budgetRes.json()) as BudgetCheckResult

        if (!budget.allowed) {
          return NextResponse.json(
            {
              error: "Budget exceeded",
              agent: budget.agentName ?? assignee,
              spentUsd: budget.spentUsd,
              budgetUsd: budget.budgetUsd,
              percentUsed: budget.percentUsed,
            },
            { status: 403 }
          )
        }

        if (budget.warning) {
          budgetWarning = { warning: budget.warning, percentUsed: budget.percentUsed }
        }
      } catch {
        // fail open
      }
    }

    runtime.activate({
      taskId,
      title,
      description,
      assignee,
      priority,
      callbackUrl: MC_URL,
      message,
      ...(worktree ? { worktree: { path: worktree.path, branch: worktree.branch, baseRef: worktree.baseRef } } : {}),
    } as Parameters<typeof runtime.activate>[0] & { message: string }).catch(() => null)

    try {
      const origin = new URL(request.url).origin
      await fetch(`${origin}/api/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          from: CHIEF_RUNTIME_KEY,
          to: assignee || "unassigned",
          content: `Delegating task: ${title}${description ? `\n${description}` : ""}`,
          type: "delegation",
          taskId,
          taskTitle: title,
        }),
      }).catch(() => null)
    } catch {
      // non-fatal
    }

    return NextResponse.json({ ok: true, conversationId: conversation.id, worktree, ...budgetWarning })
  } catch {
    return NextResponse.json({ error: "Failed to activate task" }, { status: 500 })
  }
}
