/**
 * Give an allowlisted iMessage chat a Dinghy user without waiting for Google.
 *
 * The database function (migration 059) does the work atomically and only for
 * chats on beta_allowlist. This wrapper never throws: provisioning is
 * best-effort at every call site, and loadImessageToolContext retries it, so
 * a failure here costs a retry, not a broken chat.
 */
import { createServerClient } from '@/lib/supabase/server'

export async function provisionSpectrumIdentity(chatGuid: string, handle?: string | null): Promise<string | null> {
    try {
        const { data, error } = await createServerClient().rpc('provision_spectrum_identity', {
            p_chat_guid: chatGuid,
            p_handle: handle ?? null,
        })
        if (error) {
            console.error('provision_spectrum_identity failed:', error.message)
            return null
        }
        return typeof data === 'string' && data ? data : null
    } catch (err) {
        console.error('provision_spectrum_identity threw:', err instanceof Error ? err.message : String(err))
        return null
    }
}
