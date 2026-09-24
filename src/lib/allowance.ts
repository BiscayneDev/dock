/**
 * Daily usage allowance (migration 045): one pool per account, in
 * USD-cost-equivalent, covering ALL work — LLM calls, sandbox time,
 * briefings, sweeps. Resets at midnight in the account's timezone.
 * Invisible until the limit is hit: no counters, no per-message cost, one
 * plain message at the limit, then quiet until reset.
 *
 * Replaces the "30 free sandbox minutes per day" gate. The $5/day hard cap
 * and the server-side kill switch (computer/metering.ts) are unchanged and
 * sit above this: the allowance is the free tier, the hard cap is the
 * global backstop.
 *
 * Fail open: a metering outage must never mute the product. Callers get
 * `over: false` and the error is logged.
 */

import { createServerClient } from '@/lib/supabase/server'

export const DEFAULT_DAILY_ALLOWANCE_USD = 2.0
export const FALLBACK_TZ = 'America/New_York'

export interface DailyUsage {
  tz: string
  dayStart: string
  llmCostUsd: number
  sandboxCostUsd: number
  costUsd: number
  allowanceUsd: number
  remainingUsd: number
  over: boolean
  resetsAt: string
}

type Supabase = ReturnType<typeof createServerClient>

/** Today's usage for an account. Pass chatGuid (iMessage) and/or userId. */
export async function getDailyUsage(
  params: { chatGuid?: string | null; userId?: string | null; tz?: string | null },
  supabase: Supabase = createServerClient()
): Promise<DailyUsage> {
  const { data, error } = await supabase.rpc('dinghy_daily_usage', {
    p_chat_guid: params.chatGuid ?? null,
    p_user_id: params.userId ?? null,
    p_tz: params.tz ?? null,
  })
  if (error) throw new Error(`dinghy_daily_usage: ${error.message}`)
  const d = data as Record<string, unknown>
  return {
    tz: String(d.tz ?? FALLBACK_TZ),
    dayStart: String(d.day_start ?? ''),
    llmCostUsd: Number(d.llm_cost_usd ?? 0),
    sandboxCostUsd: Number(d.sandbox_cost_usd ?? 0),
    costUsd: Number(d.cost_usd ?? 0),
    allowanceUsd: Number(d.allowance_usd ?? DEFAULT_DAILY_ALLOWANCE_USD),
    remainingUsd: Number(d.remaining_usd ?? 0),
    over: d.over === true,
    resetsAt: String(d.resets_at ?? ''),
  }
}

/**
 * Allowance gate. Fails OPEN on metering errors (logged, never surfaced):
 * a broken meter must not silence the product.
 */
export async function isOverDailyAllowance(
  params: { chatGuid?: string | null; userId?: string | null; tz?: string | null },
  supabase: Supabase = createServerClient()
): Promise<{ over: boolean; usage: DailyUsage | null }> {
  try {
    const usage = await getDailyUsage(params, supabase)
    return { over: usage.over, usage }
  } catch (err) {
    console.error('daily allowance check failed; allowing', err instanceof Error ? err.message : String(err))
    return { over: false, usage: null }
  }
}

/** The only thing a user ever sees about the allowance, sent once a day. */
export function allowanceUsedUpMessage(): string {
  return "You've used today's allowance. I'm back at midnight your time."
}

/**
 * Claim this chat's one at-limit notice for the local day. True exactly
 * once per day; false afterwards (stay quiet until reset). On error,
 * returns false — a duplicated silence beats a duplicated notice.
 */
export async function claimLimitNotice(
  chatGuid: string,
  supabase: Supabase = createServerClient()
): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc('dinghy_claim_limit_notice', {
      p_chat_guid: chatGuid,
      p_tz: FALLBACK_TZ,
    })
    if (error) throw new Error(error.message)
    return data === true
  } catch (err) {
    console.error('limit notice claim failed', err instanceof Error ? err.message : String(err))
    return false
  }
}
