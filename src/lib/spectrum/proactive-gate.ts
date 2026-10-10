/**
 * Quiet by default. Proactive work (today: the morning brief) is three small
 * decisions, made from cheap facts before any token is decrypted or any model
 * is called:
 *   1. worth doing: is this user due at all (right local hour, not muted, not quiet hours)?
 *   2. when to look again: if not now, how long until the next look.
 *   3. whether to interrupt: never cut into a live conversation.
 * Pure functions; the cron supplies the facts. Nothing here reads message text.
 */

export const BRIEF_FIRST_HOUR = 8
/** The brief may slip to the next hour when the user is mid-conversation. */
export const BRIEF_LAST_HOUR = 9
/** A text in the last 10 minutes means a conversation is live. */
export const LIVE_CONVERSATION_MS = 10 * 60 * 1000

export type ProactiveFacts = {
    /** User's local hour 0-23. */
    localHour: number
    /** "Brief me now" was asked for: skips the window and the interruption check. */
    forced: boolean
    inQuietHours: boolean
    /** Milliseconds since the user's last text in this chat, null when none known. */
    sinceLastUserTextMs: number | null
}

export type ProactiveDecision =
    | { act: 'now' }
    | { act: 'skip'; reason: 'not_due' | 'quiet_hours' }
    | { act: 'wait'; reason: 'live_conversation'; recheckInMinutes: number }

export function decideBrief(f: ProactiveFacts): ProactiveDecision {
    if (f.forced) return { act: 'now' }
    if (f.inQuietHours) return { act: 'skip', reason: 'quiet_hours' }
    if (f.localHour < BRIEF_FIRST_HOUR || f.localHour > BRIEF_LAST_HOUR) return { act: 'skip', reason: 'not_due' }
    if (f.sinceLastUserTextMs !== null && f.sinceLastUserTextMs < LIVE_CONVERSATION_MS) {
        // Interrupting is the expensive mistake. The hourly cron looks again,
        // but only inside the window: the last hour never defers past it.
        if (f.localHour >= BRIEF_LAST_HOUR) return { act: 'now' }
        return { act: 'wait', reason: 'live_conversation', recheckInMinutes: 60 }
    }
    return { act: 'now' }
}

export type UserRow = { id: string; timezone: string | null; quiet_hours_start: string | null; quiet_hours_end: string | null }

/** Latest user-text time per chat, from rows ordered or not. */
export function lastTextByChat(rows: { chat_guid: string; created_at: string }[]): Map<string, number> {
    const out = new Map<string, number>()
    for (const r of rows) {
        const t = Date.parse(r.created_at)
        if (!Number.isFinite(t)) continue
        if (t > (out.get(r.chat_guid) ?? 0)) out.set(r.chat_guid, t)
    }
    return out
}
