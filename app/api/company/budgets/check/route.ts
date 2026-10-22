import { NextRequest, NextResponse } from "next/server"
import { CHIEF_ROLE_LABEL, CHIEF_RUNTIME_KEY } from "@/lib/chief-key"

/**
 * GET /api/company/budgets/check?agent=builder
 * Returns whether an agent is allowed to activate (under budget).
 */
export async function GET(request: NextRequest) {
  const agentId = request.nextUrl.searchParams.get("agent")
  if (!agentId) {
    return NextResponse.json({ error: "agent query param required" }, { status: 400 })
  }

  try {
    // Fetch full budget data from the parent route
    const origin = request.nextUrl.origin
    const res = await fetch(`${origin}/api/company/budgets`)
    const data = (await res.json()) as { agents: Array<{ name: string; spentUsd: number; budgetUsd: number }> }

    // Map agent IDs to display names
    const AGENT_ID_TO_NAME: Record<string, string> = {
      [CHIEF_RUNTIME_KEY]: CHIEF_ROLE_LABEL,
      scout: "Scout",
      builder: "Builder",
      "deal-flow": "Deal Flow",
      baron: "Baron",
    }

    const displayName = AGENT_ID_TO_NAME[agentId] ?? agentId
    const agent = data.agents.find(
      (a) => a.name.toLowerCase() === displayName.toLowerCase()
    )

    if (!agent) {
      return NextResponse.json({
        allowed: true,
        spentUsd: 0,
        budgetUsd: 0,
        percentUsed: 0,
        warning: null,
      })
    }

    const percentUsed = agent.budgetUsd > 0
      ? Math.round((agent.spentUsd / agent.budgetUsd) * 100)
      : 0

    const allowed = agent.budgetUsd <= 0 || agent.spentUsd < agent.budgetUsd
    const warning = percentUsed >= 80 && allowed ? "approaching_limit" : null

    return NextResponse.json({
      allowed,
      agentName: agent.name,
      spentUsd: agent.spentUsd,
      budgetUsd: agent.budgetUsd,
      percentUsed,
      warning,
    })
  } catch {
    // On error, allow activation (fail open) but log warning
    return NextResponse.json({
      allowed: true,
      spentUsd: 0,
      budgetUsd: 0,
      percentUsed: 0,
      warning: null,
    })
  }
}
