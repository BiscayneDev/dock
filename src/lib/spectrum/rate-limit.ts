/**
 * Per-chat rate limit on the public iMessage line (migration 022):
 * 20 messages / 10 min and 200 / day. The owner is exempt.
 */
import { createServerClient } from '@/lib/supabase/server'

export type RateResult = 'ok' | 'limited_notify' | 'limited'

export const RATE_NOTICE = "you're sending a lot at once - give me a few minutes and try again."

/** Fails open to 'ok' on DB error: dedupe and the beta gate already need the DB. */
export async function hitRateLimit(chatGuid: string): Promise<RateResult> {
    const { data, error } = await createServerClient().rpc('hit_rate_limit', { p_chat_guid: chatGuid })
    if (error) {
        console.error('rate limit check failed (allowing):', error.message)
        return 'ok'
    }
    return (data as RateResult) ?? 'ok'
}
