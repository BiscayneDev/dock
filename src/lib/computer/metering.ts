/**
 * Computer allowance + kill switch (Workstream G3).
 *
 * Sandbox seconds land in the shared spend ledger (spend_events,
 * source='sandbox'), so the daily cap covers sandbox infra and money on
 * one total. Free allowance: computer_settings.free_seconds_per_day
 * (default 1800 = 30 min, ≈ $0.085/day of infra). Beyond free, more
 * sandbox time is bought as a confirm-gated overage block
 * (computer_overage, in CONFIRM_TOOLS). The hard cap ($5/day default)
 * blocks everything and kills the sandbox server-side.
 */

import { createServerClient } from '@/lib/supabase/server'
import { getDailySpend } from '@/lib/payments/spend-caps'
import { USD_PER_SECOND, type ComputerProvider, type ComputerSessionRow } from './manager'

export type SupabaseClient = ReturnType<typeof createServerClient>

/** One overage purchase: $1 buys another ~6 hours of sandbox time. */
export const OVERAGE_BLOCK_USD = 1.0
export const OVERAGE_BLOCK_SECONDS = 6 * 3600

export interface ComputerSettings {
  freeSecondsPerDay: number
  hardCapUsdPerDay: number
  enabled: boolean
}

const DEFAULT_SETTINGS: ComputerSettings = {
  freeSecondsPerDay: 1800,
  hardCapUsdPerDay: 5.0,
  enabled: true,
}

export async function getComputerSettings(
  userId: string,
  supabase: SupabaseClient = createServerClient()
): Promise<ComputerSettings> {
  const { data } = await supabase
    .from('computer_settings')
    .select('free_seconds_per_day, hard_cap_usd_per_day, enabled')
    .eq('user_id', userId)
    .maybeSingle()

  if (!data) return DEFAULT_SETTINGS
  return {
    freeSecondsPerDay: Number(data.free_seconds_per_day ?? DEFAULT_SETTINGS.freeSecondsPerDay),
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
    const match = /:(\d+)s$/.exec(row.memo ?? '')
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
  | { allowed: true; sandboxSecondsToday: number; freeSecondsPerDay: number; settings: ComputerSettings }
  | { allowed: false; needsApproval: true; overageUsd: number; sandboxSecondsToday: number; reason: string }
  | { allowed: false; blocked: true; reason: string; settings: ComputerSettings }

/**
 * Check before every run. Free seconds remaining → allowed. Free spent and
 * no overage today → needsApproval (confirm-gated $1 block). Free spent,
 * overage bought → allowed until the hard cap. Today's total spend (all
 * sources) plus the projected overage block above the hard cap → blocked.
 */
export async function assertComputerAllowed(
  userId: string,
  supabase: SupabaseClient = createServerClient()
): Promise<Allowance> {
  const settings = await getComputerSettings(userId, supabase)
  const used = await getTodaySandboxSeconds(userId, supabase)

  if (used < settings.freeSecondsPerDay) {
    return { allowed: true, sandboxSecondsToday: used, freeSecondsPerDay: settings.freeSecondsPerDay, settings }
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
    return {
      allowed: false,
      needsApproval: true,
      overageUsd: OVERAGE_BLOCK_USD,
      sandboxSecondsToday: used,
      reason: `Free computer time is used up (${Math.round(used)}s today). $${OVERAGE_BLOCK_USD.toFixed(2)} buys another ${OVERAGE_BLOCK_SECONDS / 3600}h.`,
    }
  }

  return { allowed: true, sandboxSecondsToday: used, freeSecondsPerDay: settings.freeSecondsPerDay, settings }
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

export async function stopSessionWithProvider(
  userId: string,
  session: ComputerSessionRow,
  supabase: SupabaseClient,
  provider: ComputerProvider
): Promise<void> {
  if (session.sandbox_id) await provider.stop(session.sandbox_id)
  const { error } = await supabase
    .from('computer_sessions')
    .update({ status: 'killed', killed_reason: 'hard_cap_exceeded' })
    .eq('id', session.id)
  if (error) throw new Error(`Failed to kill computer session: ${error.message}`)
}
