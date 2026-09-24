import { createServerClient } from '@/lib/supabase/server'

// Daily spend caps for agent-initiated money movement.
//
// Today's settled spend is summed from `spend_events` — the shared ledger that
// every rail writes to on settlement (paybox payments/swaps, wallet_send,
// x402 paid calls, recipe payments). Paybox request tools and wallet_send
// check the cap before any money moves; when a tool cannot price its action
// in USD (e.g. wallet_send in native units), it records amount_usd = 0 with
// the raw amount in memo and still checks with amount 0 so a user already
// over cap is blocked from moving anything.
//
// recordSpend fails closed: callers must treat a ledger-write failure as a
// failed spend (surface the error, do not proceed), so an unreadable or
// unwritable ledger can never silently lift the cap.

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

export type SpendSource =
  | 'paybox_payment'
  | 'paybox_swap'
  | 'wallet_send'
  | 'x402'
  | 'recipe'
  | 'sandbox'

/**
 * Record a settled money movement in the shared spend ledger. Throws on
 * failure — callers must fail closed (treat the spend as failed / surface
 * the error), never swallow ledger-write errors.
 */
export async function recordSpend(
  userId: string,
  source: SpendSource,
  amountUsd: number,
  memo?: string,
  supabase: ReturnType<typeof createServerClient> = createServerClient()
): Promise<void> {
  const { error } = await supabase.from('spend_events').insert({
    user_id: userId,
    source,
    amount_usd: amountUsd,
    currency: 'USD',
    memo: memo ?? null,
  })

  if (error) {
    throw new Error(`Failed to record spend in ledger: ${error.message}`)
  }
}

export async function getDailySpend(
  userId: string,
  supabase: ReturnType<typeof createServerClient> = createServerClient()
): Promise<number> {
  const { data, error } = await supabase
    .from('spend_events')
    .select('amount_usd')
    .eq('user_id', userId)
    .gte('created_at', startOfTodayUtcIso())

  if (error) {
    // Fail closed: an unreadable ledger must not silently lift the cap.
    throw new Error(`Failed to read daily spend: ${error.message}`)
  }

  return (data ?? []).reduce((sum, row) => sum + Number(row.amount_usd ?? 0), 0)
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
