/**
 * Reminders on the iMessage path: reminder_set / reminder_list /
 * reminder_cancel keyed by the Spectrum chat, with times read in the
 * chat's timezone. Delivery is the reminders cron, which claims due rows
 * (dinghy_claim_due_reminders, migration 029) and enqueues them on the
 * Spectrum outbox so the sweep sends and retries them.
 *
 * Open to every chat, bound or not: a reminder only ever goes back to the
 * chat that set it.
 */

import { createServerClient } from '@/lib/supabase/server'
import type { Tool, ToolResult } from '@/lib/llm/types'

export const DEFAULT_TZ = 'America/New_York'

/** Offset of tz from UTC at the given instant, in ms (e.g. -4h for EDT). */
export function tzOffsetMs(at: Date, tz: string): number {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        hourCycle: 'h23',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(at)
    const n = (t: string) => Number(parts.find((p) => p.type === t)?.value)
    const asUtc = Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'), n('second'))
    return asUtc - Math.floor(at.getTime() / 1000) * 1000
}

const LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/

/** A wall-clock time ("2026-09-23T17:00") in tz, as a UTC instant. */
export function localToUtc(local: string, tz: string): Date | null {
    const m = LOCAL_RE.exec(local.trim())
    if (!m) return null
    const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], m[6] ? +m[6] : 0)
    let t = guess - tzOffsetMs(new Date(guess), tz)
    // Second pass settles DST edges where the offset differs at the result.
    t = guess - tzOffsetMs(new Date(t), tz)
    return new Date(t)
}

/** "Wed, Sep 23, 5:00 PM" in tz. */
export function formatLocal(at: Date, tz: string): string {
    return new Intl.DateTimeFormat('en-US', {
        timeZone: tz, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    }).format(at)
}

/** Current wall-clock time in tz as "YYYY-MM-DDTHH:mm" (for the tool description). */
export function localNow(now: Date, tz: string): string {
    const off = tzOffsetMs(now, tz)
    return new Date(now.getTime() + off).toISOString().slice(0, 16)
}

export function validTimezone(tz: string | null | undefined): string {
    if (!tz) return DEFAULT_TZ
    try {
        new Intl.DateTimeFormat('en-US', { timeZone: tz })
        return tz
    } catch {
        return DEFAULT_TZ
    }
}

/**
 * Resolve the tool input to a fire time. `in_minutes` wins; otherwise `at`
 * is a local wall-clock time in tz (an explicit offset or Z is honoured).
 */
export function resolveFireAt(
    input: { at?: unknown; in_minutes?: unknown },
    tz: string,
    now: Date
): Date | { error: string } {
    if (input.in_minutes !== undefined && input.in_minutes !== null && input.in_minutes !== '') {
        const mins = Number(input.in_minutes)
        if (!Number.isFinite(mins) || mins <= 0) return { error: 'in_minutes must be a positive number' }
        return new Date(now.getTime() + Math.round(mins * 60_000))
    }
    if (typeof input.at !== 'string' || !input.at.trim()) return { error: 'give either at (local time) or in_minutes' }
    const at = input.at.trim()
    const d = /(Z|[+-]\d{2}:?\d{2})$/.test(at) ? new Date(at) : localToUtc(at, tz)
    if (!d || Number.isNaN(d.getTime())) return { error: `could not read time "${at}"; use YYYY-MM-DDTHH:mm` }
    if (d.getTime() <= now.getTime()) return { error: `${formatLocal(d, tz)} is already in the past` }
    if (d.getTime() - now.getTime() > 366 * 24 * 3_600_000) return { error: 'reminders can be at most a year out' }
    return d
}

const fail = (error: string): ToolResult => ({ success: false, error })

export function reminderToolsFor(chatGuid: string, userId: string | null, timezone: string | null | undefined, now: () => Date = () => new Date()): Tool[] {
    const tz = validTimezone(timezone)
    const nowLocal = localNow(now(), tz)

    const set: Tool = {
        name: 'reminder_set',
        description:
            `Set a reminder that texts this chat at a given time. Times are in ${tz}; it is now ${nowLocal} there. ` +
            'Pass at as a local wall-clock time YYYY-MM-DDTHH:mm (e.g. "remind me at 5" today = the date above with T17:00), ' +
            'or in_minutes for relative times ("in 20 minutes"). Confirm the time back in plain words.',
        inputSchema: {
            type: 'object',
            properties: {
                message: { type: 'string', description: 'What to remind them about, short, e.g. "call Pia"' },
                at: { type: 'string', description: `Local time in ${tz}, YYYY-MM-DDTHH:mm` },
                in_minutes: { type: 'number', description: 'Minutes from now, for relative reminders' },
            },
            required: ['message'],
        },
        async execute(input) {
            const i = (input ?? {}) as Record<string, unknown>
            const message = typeof i.message === 'string' ? i.message.trim() : ''
            if (!message) return fail('message is required')
            if (message.length > 500) return fail('message is too long (max 500 characters)')
            const fireAt = resolveFireAt(i, tz, now())
            if ('error' in fireAt) return fail(fireAt.error)
            const { data, error } = await createServerClient().rpc('dinghy_reminder_create', {
                p_chat_guid: chatGuid,
                p_user_id: userId || null,
                p_message: message,
                p_fire_at: fireAt.toISOString(),
            })
            if (error) return fail(`could not save the reminder: ${error.message}`)
            const row = data as { id: string }
            return { success: true, data: { id: row.id, message, when: formatLocal(fireAt, tz), timezone: tz } }
        },
    }

    const list: Tool = {
        name: 'reminder_list',
        description: 'List the reminders still pending for this chat, soonest first.',
        inputSchema: { type: 'object', properties: {} },
        async execute() {
            const { data, error } = await createServerClient().rpc('dinghy_reminder_list', { p_chat_guid: chatGuid })
            if (error) return fail(`could not load reminders: ${error.message}`)
            const rows = (data as { id: string; message: string; fire_at: string }[] | null) ?? []
            return {
                success: true,
                data: rows.map((r) => ({ id: r.id, message: r.message, when: formatLocal(new Date(r.fire_at), tz) })),
            }
        },
    }

    const cancel: Tool = {
        name: 'reminder_cancel',
        description: 'Cancel a pending reminder in this chat by its id (from reminder_list).',
        inputSchema: {
            type: 'object',
            properties: { id: { type: 'string', description: 'Reminder id from reminder_list' } },
            required: ['id'],
        },
        async execute(input) {
            const id = typeof (input as { id?: unknown })?.id === 'string' ? (input as { id: string }).id.trim() : ''
            if (!/^[0-9a-f-]{36}$/i.test(id)) return fail('id must be a reminder id from reminder_list')
            const { data, error } = await createServerClient().rpc('dinghy_reminder_cancel', { p_chat_guid: chatGuid, p_id: id })
            if (error) return fail(`could not cancel: ${error.message}`)
            if (!data) return fail('no pending reminder with that id in this chat')
            return { success: true, data: { cancelled: true } }
        },
    }

    return [set, list, cancel]
}

/** The text a reminder arrives as. */
export function reminderText(message: string): string {
    return `Reminder: ${message}`
}
