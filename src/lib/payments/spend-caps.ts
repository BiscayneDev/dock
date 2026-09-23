import { createServerClient } from '@/lib/supabase/server'

// Daily spend caps for agent-initiated money movement.
//
// Today's settled spend is summed from `recipe_payments` — the only existing
// ledger of completed on-chain payments keyed by payer. Paybox request tools
// and wallet_send check the cap before any money moves; when a tool cannot
// price its action in USD (e.g. wallet_send in native units), it still checks
// with amount 0 so a user already over cap is blocked from moving anything.
//
// TODO(follow-up): route Paybox/x402 spend through a shared ledger table so
// getDailySpend covers all rails, not just recipe payments.

export interface SpendCapResult {
  allowed: boolean
  reason?: string
}

export function checkCap(spendToday: number, capUsd: number, amountUsd: number): SpendCapResult {
  if (spendToday + amountUsd > capUsd) {
    return {
      allowed: false,
      reason:
        `Daily spend cap exceeded: $${spendToday.toFixed(2)} spent today, ` +
        `$${amountUsd.toFixed(2)} requested, cap $${capUsd.toFixed(2)}.`,
    }
  }
  return { allowed: true }
}

function startOfTodayUtcIso(): string {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString()
}

export async function getDailySpend(
  userId: string,
  supabase: ReturnType<typeof createServerClient> = createServerClient()
): Promise<number> {
  const { data, error } = await supabase
    .from('recipe_payments')
    .select('amount')
    .eq('payer_id', userId)
    .eq('status', 'completed')
    .gte('completed_at', startOfTodayUtcIso())

  if (error) {
    // Fail closed: an unreadable ledger must not silently lift the cap.
    throw new Error(`Failed to read daily spend: ${error.message}`)
  }

  return (data ?? []).reduce((sum, row) => sum + Number(row.amount ?? 0), 0)
}

export async function getDailyCap(
  userId: string,
  supabase: ReturnType<typeof createServerClient> = createServerClient()
): Promise<number> {
  const { data } = await supabase
    .from('spend_limits')
    .select('daily_usd')
    .eq('user_id', userId)
    .maybeSingle()

  return Number(data?.daily_usd ?? 50)
}

/**
 * Throws when today's settled spend + amountUsd would exceed the user's daily
 * cap. Call before any money moves.
 */
export async function assertWithinCap(
  userId: string,
  amountUsd: number,
  supabase: ReturnType<typeof createServerClient> = createServerClient()
): Promise<void> {
  const [spend, cap] = await Promise.all([
    getDailySpend(userId, supabase),
    getDailyCap(userId, supabase),
  ])
  const result = checkCap(spend, cap, amountUsd)
  if (!result.allowed) {
    throw new Error(result.reason ?? 'Daily spend cap exceeded')
  }
}
