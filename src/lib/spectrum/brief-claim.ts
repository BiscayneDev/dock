/**
 * Pre-model claim for the morning brief (migration 057).
 *
 * The claim is taken BEFORE the paid model call so overlapping or replayed
 * cron runs cannot each pay for a generation. A lease lets a crashed run be
 * retried (bounded attempts); a finished brief stays 'sent' for the day.
 *
 * Fail closed on claim errors: skipping one brief beats paying twice.
 */

import { createServerClient } from '@/lib/supabase/server'

/** Longer than the cron's 300s maxDuration, so a live run never loses its lease. */
export const BRIEF_LEASE_MS = 10 * 60 * 1000
export const BRIEF_MAX_ATTEMPTS = 3

/** Request key: the scheduled brief shares 'daily'; "brief me now" gets its own. */
export function briefRequestKey(forceUntil: string | null): string {
    return forceUntil ? `now:${forceUntil}` : 'daily'
}

export type BriefClaim = { ok: true } | { ok: false; reason: 'held' | 'error'; error?: string }

export async function claimBrief(userId: string, localDay: string, requestKey: string): Promise<BriefClaim> {
    const { data, error } = await createServerClient().rpc('claim_dinghy_brief', {
        p_user_id: userId,
        p_local_day: localDay,
        p_request_key: requestKey,
        p_lease_ms: BRIEF_LEASE_MS,
        p_max_attempts: BRIEF_MAX_ATTEMPTS,
    })
    if (error) return { ok: false, reason: 'error', error: error.message }
    return data === true ? { ok: true } : { ok: false, reason: 'held' }
}

/** The brief is queued in the outbox: the day is done for this key. */
export async function completeBrief(userId: string, localDay: string, requestKey: string): Promise<void> {
    const { error } = await createServerClient()
        .from('dinghy_brief_delivery')
        .update({ status: 'sent', completed_at: new Date().toISOString() })
        .eq('user_id', userId)
        .eq('local_day', localDay)
        .eq('request_key', requestKey)
    if (error) throw new Error(`brief complete failed: ${error.message}`)
}

/** Generation failed before queueing: expire the lease so a retry can claim it. */
export async function releaseBrief(userId: string, localDay: string, requestKey: string): Promise<void> {
    await createServerClient()
        .from('dinghy_brief_delivery')
        .update({ lease_expires_at: new Date(0).toISOString() })
        .eq('user_id', userId)
        .eq('local_day', localDay)
        .eq('request_key', requestKey)
        .eq('status', 'claimed')
}
