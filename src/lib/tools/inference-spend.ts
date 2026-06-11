import type { Tool, ToolResult, UserContext } from '@/lib/llm/types'
import { createServerClient } from '@/lib/supabase/server'

// Lets the assistant answer "what's my AI spend / how much have I saved?" — it
// routes every request through the shipyard cost-router and meters each one to
// inference_usage (charged_usd = routed cost + margin, capped below the direct
// baseline). Spend is billed to the user's own Paybox wallet via settlement.

interface SummaryTotals {
  requests: number
  actualUsd: number
  chargedUsd: number
  baselineUsd: number
}

export const getInferenceSpend: Tool = {
  name: 'get_inference_spend',
  description:
    "Get the current user's own AI inference spend and savings: how much they've " +
    'spent on this assistant (billed to their Paybox wallet), how much that saved ' +
    'versus calling the frontier models direct, request count, and how much is ' +
    'settled vs still pending. Call this whenever the user asks about their AI cost, ' +
    'spend, bill, usage, or savings. Takes no input — always scoped to the current user.',
  inputSchema: { type: 'object', properties: {} },
  async execute(_input: unknown, ctx: UserContext): Promise<ToolResult> {
    try {
      const supabase = createServerClient()

      const { data: summary, error: summaryErr } = await supabase.rpc(
        'inference_savings_summary',
        { p_user_id: ctx.userId },
      )
      if (summaryErr) return { success: false, error: summaryErr.message }

      const u = (summary as { user: SummaryTotals }).user
      const spendUsd = u.chargedUsd
      const baselineUsd = u.baselineUsd
      const savedUsd = Math.max(0, baselineUsd - spendUsd)
      const savedPct = baselineUsd > 0 ? (savedUsd / baselineUsd) * 100 : 0

      // Settled (transferred to treasury) vs still-pending balance.
      const [{ data: settledRows }, { data: pendingRows }] = await Promise.all([
        supabase
          .from('inference_settlements')
          .select('owed_usd')
          .eq('user_id', ctx.userId)
          .eq('status', 'settled'),
        supabase
          .from('inference_usage')
          .select('charged_usd')
          .eq('user_id', ctx.userId)
          .is('settlement_id', null)
          .not('charged_usd', 'is', null),
      ])

      const settledUsd = (settledRows ?? []).reduce(
        (s, r) => s + Number((r as { owed_usd: number }).owed_usd ?? 0),
        0,
      )
      const pendingUsd = (pendingRows ?? []).reduce(
        (s, r) => s + Number((r as { charged_usd: number }).charged_usd ?? 0),
        0,
      )

      const usd = (n: number) => `$${n.toFixed(n < 0.01 ? 4 : 2)}`

      return {
        success: true,
        data: {
          requests: u.requests,
          spend: usd(spendUsd),
          wouldHaveCostDirect: usd(baselineUsd),
          saved: usd(savedUsd),
          savedPercent: `${savedPct.toFixed(0)}%`,
          settledToWallet: usd(settledUsd),
          pendingSettlement: usd(pendingUsd),
          note:
            'Spend is the discounted, cost-routed price (still below the direct-API ' +
            'baseline). It is billed to the user’s own Paybox wallet.',
        },
      }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  },
}
