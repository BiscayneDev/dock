/**
 * Morning briefing opt-in state (migration 033).
 *
 * Default-on for any chat bound to a user with Google connected; a row in
 * briefing_settings overrides the default. The digest itself carries the
 * mute footer, and the handler honors "mute mornings" / "unmute mornings"
 * by flipping `muted` here.
 */

import { createServerClient } from '@/lib/supabase/server'

/** The exact opt-out line that ends every digest. */
export const MUTE_FOOTER = 'reply mute mornings to stop these'

export const MUTE_ACK = 'ok, mornings muted. say "unmute mornings" any time to bring them back.'
export const UNMUTE_ACK = 'mornings are back on — expect the next briefing around 8.'
export const NO_BOUND_ACCOUNT_ACK = "no account is connected to this chat, so there's no briefing to mute."

/**
 * Whether this chat should receive today's briefing. A settings row wins;
 * no row means default-on (the caller has already checked Google).
 */
export async function isBriefingEnabled(userId: string): Promise<boolean> {
    const supabase = createServerClient()
    const { data, error } = await supabase
        .from('briefing_settings')
        .select('enabled, muted')
        .eq('user_id', userId)
        .maybeSingle()
    if (error) {
        console.error('briefing settings load failed:', error.message)
        return false
    }
    if (!data) return true
    return Boolean(data.enabled) && !Boolean(data.muted)
}

/** Resolve the chat's bound user id, or null for a guest chat. */
export async function briefableUserId(chatGuid: string): Promise<string | null> {
    const supabase = createServerClient()
    const { data } = await supabase
        .from('spectrum_identities')
        .select('user_id')
        .eq('chat_guid', chatGuid)
        .maybeSingle()
    return (data?.user_id as string | null) ?? null
}

/**
 * Honor the exact "mute mornings" / "unmute mornings" intent from the chat.
 * Returns the ack to text back, or null when the text is not a mute command.
 */
export async function handleMuteIntent(chatGuid: string, text: string): Promise<string | null> {
    const lower = text.toLowerCase()
    const wantsUnmute = /unmute\s+mornings/.test(lower)
    const wantsMute = !wantsUnmute && /mute\s+mornings/.test(lower)
    if (!wantsMute && !wantsUnmute) return null

    const userId = await briefableUserId(chatGuid)
    if (!userId) return NO_BOUND_ACCOUNT_ACK

    const supabase = createServerClient()
    const muted = wantsUnmute ? false : true
    const { error } = await supabase
        .from('briefing_settings')
        .upsert({ user_id: userId, muted, updated_at: new Date().toISOString() })
    if (error) {
        console.error('briefing settings update failed:', error.message)
        return wantsUnmute
            ? "couldn't save that - try again in a moment."
            : "couldn't save that - try again in a moment."
    }
    return wantsUnmute ? UNMUTE_ACK : MUTE_ACK
}
