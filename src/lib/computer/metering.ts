/**
 * Computer allowance + kill switch (Workstream G3, reworked by 045).
 *
 * The free tier is the daily usage allowance (src/lib/allowance.ts): one
 * USD-cost pool per account covering ALL work — LLM calls, sandbox time,
 * briefings — resetting at midnight in the account's timezone. Invisible
 * until it is hit. Sandbox seconds still land in the shared spend ledger
 * (spend_events, source='sandbox'), so the hard cap covers sandbox infra
 * and money on one total. Beyond the allowance, more computer time is
 * bought as a confirm-gated overage block (computer_overage, in
 * CONFIRM_TOOLS). The hard cap ($5/day default) blocks everything and
 * kills the sandbox server-side.
 */

import { createServerClient } from '@/lib/supabase/server'
import { getDailySpend } from '@/lib/payments/spend-caps'
import { isOverDailyAllowance, DEFAULT_DAILY_ALLOWANCE_USD, type DailyUsage } from '@/lib/allowance'
import { USD_PER_SECOND, type ComputerSessionRow } from './manager'

export type SupabaseClient = ReturnType<typeof createServerClient>

/** One overage purchase: $1 buys another ~6 hours of sandbox time. */
export const OVERAGE_BLOCK_USD = 1.0
export const OVERAGE_BLOCK_SECONDS = 6 * 3600

export interface ComputerSettings {
  dailyAllowanceUsd: number
  allowanceTimezone: string | null
  hardCapUsdPerDay: number
  enabled: boolean
}

const DEFAULT_SETTINGS: ComputerSettings = {
  dailyAllowanceUsd: DEFAULT_DAILY_ALLOWANCE_USD,
  allowanceTimezone: null,
  hardCapUsdPerDay: 5.0,
  enabled: true,
}

export async function getComputerSettings(
  userId: string,
  supabase: SupabaseClient = createServerClient()
): Promise<ComputerSettings> {
  const { data } = await supabase
    .from('computer_settings')
    .select('daily_allowance_usd, allowance_timezone, hard_cap_usd_per_day, enabled')
    .eq('user_id', userId)
    .maybeSingle()

  if (!data) return DEFAULT_SETTINGS
  return {
    dailyAllowanceUsd: Number(data.daily_allowance_usd ?? DEFAULT_SETTINGS.dailyAllowanceUsd),
    allowanceTimezone: (data.allowance_timezone as string | null) ?? null,
    hardCapUsdPerDay: Number(data.hard_cap_usd_per_day ?? DEFAULT_SETTINGS.hardCapUsdPerDay),
    enabled: data.enabled !== false,
  }
}

function startOfTodayUtcIso(): string {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString()
}

/**
 * Today's sandbox seconds, from the ledger. Metering rows have memo
 * `<sessionId>:<seconds>s`; overage purchases have memo `overage:<...>`
 * and are excluded (they are money, not seconds).
 */
export async function getTodaySandboxSeconds(
  userId: string,
  supabase: SupabaseClient = createServerClient()
): Promise<number> {
  const { data, error } = await supabase
    .from('spend_events')
    .select('amount_usd, memo')
    .eq('user_id', userId)
    .eq('source', 'sandbox')
    .gte('created_at', startOfTodayUtcIso())

  if (error) throw new Error(`Failed to read sandbox usage: ${error.message}`)

  let seconds = 0
  for (const row of (data ?? []) as { amount_usd: number | string; memo: string | null }[]) {
    if (row.memo?.startsWith('overage:')) continue
    // Metering memos are `<sessionId>:<seconds>s`, optionally tagged
    // (`...s browser` for browser tasks) — the tag never hides seconds.
    const match = /:(\d+)s(?:\s|$)/.exec(row.memo ?? '')
    if (match) {
      seconds += Number(match[1])
    } else {
      // No parseable memo — fall back to the billed amount at the
      // current rate so the allowance can never be silently bypassed.
      seconds += Number(row.amount_usd ?? 0) / USD_PER_SECOND
    }
  }
  return Math.round(seconds)
}

/** True when an overage block was already bought today. */
async function overagePurchasedToday(userId: string, supabase: SupabaseClient): Promise<boolean> {
  const { data, error } = await supabase
    .from('spend_events')
    .select('memo')
    .eq('user_id', userId)
    .eq('source', 'sandbox')
    .gte('created_at', startOfTodayUtcIso())

  if (error) throw new Error(`Failed to read overage purchases: ${error.message}`)
  return ((data ?? []) as { memo: string | null }[]).some((row) => row.memo?.startsWith('overage:'))
}

export type Allowance =
  | { allowed: true; usage: DailyUsage | null; settings: ComputerSettings }
  | { allowed: false; needsApproval: true; overageUsd: number; reason: string }
  | { allowed: false; blocked: true; reason: string; settings: ComputerSettings }

/**
 * Check before every run. Under the daily allowance → allowed. Allowance
 * spent and no overage today → needsApproval (confirm-gated $1 block, or
 * wait for the midnight reset). Allowance spent, overage bought → allowed
 * until the hard cap. Today's total spend (all sources) plus the
 * projected overage block above the hard cap → blocked.
 */
export async function assertComputerAllowed(
  userId: string,
  supabase: SupabaseClient = createServerClient()
): Promise<Allowance> {
  const settings = await getComputerSettings(userId, supabase)
  const { over, usage } = await isOverDailyAllowance({ userId, tz: settings.allowanceTimezone }, supabase)

  if (!over) {
    return { allowed: true, usage, settings }
  }

  const hasOverage = await overagePurchasedToday(userId, supabase)

  // Hard cap: today's ALL-source spend + one projected overage block.
  const totalToday = await getDailySpend(userId, supabase)
  const projected = hasOverage ? USD_PER_SECOND * 60 : OVERAGE_BLOCK_USD
  if (totalToday + projected > settings.hardCapUsdPerDay) {
    return {
      allowed: false,
      blocked: true,
      reason: `Daily hard cap reached: $${totalToday.toFixed(2)} spent today, cap $${settings.hardCapUsdPerDay.toFixed(2)}.`,
      settings,
    }
  }

  if (!hasOverage) {
    const usedSoFar = usage ? `$${usage.costUsd.toFixed(2)} of $${usage.allowanceUsd.toFixed(2)}` : 'the daily allowance'
    return {
      allowed: false,
      needsApproval: true,
      overageUsd: OVERAGE_BLOCK_USD,
      reason: `Today's free allowance is used up (${usedSoFar}). It resets at midnight; $${OVERAGE_BLOCK_USD.toFixed(2)} buys another ${OVERAGE_BLOCK_SECONDS / 3600}h of computer time now.`,
    }
  }

  return { allowed: true, usage, settings }
}

/**
 * Record an approved overage purchase in the ledger. Memo is prefixed
 * `overage:` so it never counts as metered seconds.
 */
export async function recordOveragePurchase(
  userId: string,
  supabase: SupabaseClient = createServerClient()
): Promise<void> {
  const { error } = await supabase.from('spend_events').insert({
    user_id: userId,
    source: 'sandbox',
    amount_usd: OVERAGE_BLOCK_USD,
    currency: 'USD',
    memo: `overage:+${OVERAGE_BLOCK_SECONDS}s`,
  })
  if (error) throw new Error(`Failed to record overage purchase: ${error.message}`)
}

/**
 * Kill switch, server-side only: when today's ALL-source spend breaches
 * the hard cap, stop the sandbox and mark the session killed. Called by
 * the sweeper cron and checked before every run. Returns true when a kill
 * happened.
 */
export async function killIfOverCap(
  userId: string,
  session: ComputerSessionRow,
  stop: (session: ComputerSessionRow, reason: string) => Promise<void>,
  supabase: SupabaseClient = createServerClient()
): Promise<boolean> {
  const settings = await getComputerSettings(userId, supabase)
  const totalToday = await getDailySpend(userId, supabase)
  if (totalToday <= settings.hardCapUsdPerDay) return false

  await stop(session, `hard cap exceeded: $${totalToday.toFixed(2)} / $${settings.hardCapUsdPerDay.toFixed(2)}`)
  return true
}
