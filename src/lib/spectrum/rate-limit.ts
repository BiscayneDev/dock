/**
 * Per-chat rate limit on the public iMessage line (migration 022):
 * 20 messages / 10 min and 200 / day. The owner is exempt.
 */
import { createServerClient } from '@/lib/supabase/server'

export type RateResult = 'ok' | 'limited_notify' | 'limited'

export const RATE_NOTICE = "That's a lot at once. Give me a few minutes, then try again."

/** Fails open to 'ok' on DB error: dedupe and the beta gate already need the DB. */
export async function hitRateLimit(chatGuid: string): Promise<RateResult> {
    const { data, error } = await createServerClient().rpc('hit_rate_limit', { p_chat_guid: chatGuid })
    if (error) {
        console.error('rate limit check failed (allowing):', error.message)
        return 'ok'
    }
    return (data as RateResult) ?? 'ok'
}

/** Same limiter, but an unavailable limiter means "limited" (for routes that can boot paid sandboxes). */
export async function hitRateLimitStrict(key: string): Promise<RateResult> {
    try {
        const { data, error } = await createServerClient().rpc('hit_rate_limit', { p_chat_guid: key })
        if (error) {
            console.error('rate limit check failed (blocking):', error.message)
            return 'limited'
        }
        return (data as RateResult) ?? 'limited'
    } catch (err) {
        console.error('rate limit check threw (blocking):', err instanceof Error ? err.message : String(err))
        return 'limited'
    }
}
