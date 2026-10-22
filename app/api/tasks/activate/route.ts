import { NextResponse } from "next/server"
import { MC_URL } from "@/lib/config"
import { runtime } from "@/lib/runtime"
import { appendEvent, ensureTaskConversation, updateConversation } from "@/lib/conversations"
import { enrichTaskBrief } from "@/lib/task-enrichment"
import { CHIEF_RUNTIME_KEY } from "@/lib/chief-key"

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
  vic: "🦞 Vic",
  unassigned: "unassigned",
}

function buildBrief(taskId: string, title: string, description: string | undefined, assignee: string, priority: string) {
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
    const { taskId, title, description, assignee, priority } = await request.json()
    if (!taskId || !title) {
      return NextResponse.json({ error: "taskId and title required" }, { status: 400 })
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

    const message = buildBrief(taskId, enrichment.enrichedTitle, enrichment.enrichedDescription, assignee || "unassigned", priority)
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

    return NextResponse.json({ ok: true, conversationId: conversation.id, ...budgetWarning })
  } catch {
    return NextResponse.json({ error: "Failed to activate task" }, { status: 500 })
  }
}
