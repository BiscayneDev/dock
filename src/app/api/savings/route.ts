import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getSession } from '@/lib/auth/session'

export const dynamic = 'force-dynamic'

interface Totals {
  requests: number
  actualUsd: number
  baselineUsd: number
  savedUsd: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
}

interface ModelRow {
  model: string | null
  requests: number
  actualUsd: number
  baselineUsd: number
  savedUsd: number
}

interface SummaryRow {
  global: Totals
  user: Totals
  byModel: ModelRow[]
}

/** `savedUsd / baselineUsd` as a percent, guarded against divide-by-zero. */
function pct(saved: number, baseline: number): number {
  if (baseline <= 0) return 0
  return (saved / baseline) * 100
}

/**
 * Savings summary for the savings dashboard: this user's totals + per-model
 * breakdown, plus global totals across all Dock users. One RPC round trip
 * (inference_savings_summary), read via the service-role client.
 */
export async function GET(): Promise<NextResponse> {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createServerClient()
  const { data, error } = await supabase.rpc('inference_savings_summary', {
    p_user_id: session.userId,
  })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const summary = data as SummaryRow
  return NextResponse.json({
    user: {
      ...summary.user,
      savedPct: pct(summary.user.savedUsd, summary.user.baselineUsd),
    },
    global: {
      ...summary.global,
      savedPct: pct(summary.global.savedUsd, summary.global.baselineUsd),
    },
    byModel: summary.byModel.map((m) => ({
      ...m,
      savedPct: pct(m.savedUsd, m.baselineUsd),
    })),
  })
}
