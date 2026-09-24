/**
 * iMessage action tools (migration 023).
 *
 * Calendar changes that only touch the user's own calendar run straight
 * through. Anything that acts AS the user toward other people (sending an
 * email, replying, sending calendar invites) is only PROPOSED by the model:
 * the proposal is stored, the server texts the exact draft, and it runs
 * only when the user's next message is a clear yes.
 */

import { createServerClient } from '@/lib/supabase/server'
import type { Tool, ToolResult, UserContext } from '@/lib/llm/types'
import { gmailSend, gmailReply } from '@/lib/tools/gmail'
import { gcalCreateEvent, gcalUpdateEvent, gcalFindFreeTime, gcalGetEvent } from '@/lib/tools/gcal'

export type PendingKind = 'gmail_send' | 'gmail_reply' | 'gcal_create_invite' | 'computer_browse'

export interface Proposal {
    id: string
    kind: PendingKind
    payload: Record<string, unknown>
}

const CONFIRM_YES = /^\s*(y|ya|yes|yep|yeah|yup|sure|ok|okay|send|send it|do it|go|go ahead|confirm|confirmed|👍)\s*[.!]*\s*$/i
const CONFIRM_NO = /^\s*(n|no|nope|nah|cancel|stop|don'?t|do not|never ?mind|nvm|scrap it|👎)\s*[.!]*\s*$/i

export function parseConfirmation(text: string): 'yes' | 'no' | null {
    if (CONFIRM_YES.test(text)) return 'yes'
    if (CONFIRM_NO.test(text)) return 'no'
    return null
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '')

/** The exact draft the user confirms, rendered by the server (not the model). */
export function renderProposal(p: Proposal): string {
    const x = p.payload
    if (p.kind === 'gmail_send') {
        return `send this email?\n\nto: ${str(x.to)}\nsubject: ${str(x.subject)}\n\n${str(x.body)}\n\nreply y to send, n to cancel`
    }
    if (p.kind === 'gmail_reply') {
        return `send this reply${x.replyToFrom ? ` to ${str(x.replyToFrom)}` : ''}?\n\n${str(x.body)}\n\nreply y to send, n to cancel`
    }
    const attendees = Array.isArray(x.attendees) ? (x.attendees as string[]).join(', ') : ''
    if (p.kind === 'computer_browse') {
        const domains = (Array.isArray(x.urls) ? (x.urls as string[]) : []).join(', ')
        return `browse${domains ? ` ${domains}` : ''} for you while logged in?\n\n${str(x.task)}\n\nreply y to run it, n to cancel`
    }
    return `create this event and send invites?\n\n${str(x.summary)}\n${str(x.start)} to ${str(x.end)}${x.location ? `\n${str(x.location)}` : ''}\ninvites: ${attendees}\n\nreply y to send, n to cancel`
}

async function storeProposal(chatGuid: string, ctx: UserContext, kind: PendingKind, payload: Record<string, unknown>): Promise<string> {
    const { data, error } = await createServerClient().rpc('create_pending_action', {
        p_chat_guid: chatGuid,
        p_user_id: ctx.userId,
        p_kind: kind,
        p_payload: payload,
    })
    if (error) throw new Error(`could not store the draft: ${error.message}`)
    return data as string
}

/**
 * Proposal tracking for tools that live outside the actionToolsFor closure
 * (e.g. computer_browse). The last proposal made anywhere this turn wins;
 * the handler renders it as the confirmation bubble.
 */
let looseProposal: Proposal | null = null
export function lastLooseProposal(): Proposal | null {
    return looseProposal
}

/**
 * Store a proposal and return the awaiting-confirmation tool result. Used
 * by the action closure and by module-level tools like computer_browse.
 */
export async function proposeLoose(
    chatGuid: string,
    ctx: UserContext,
    kind: PendingKind,
    payload: Record<string, unknown>
): Promise<ToolResult> {
    try {
        const id = await storeProposal(chatGuid, ctx, kind, payload)
        looseProposal = { id, kind, payload }
        return PROPOSED
    } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
}

const PROPOSED: ToolResult = {
    success: true,
    data: {
        status: 'awaiting_user_confirmation',
        note: 'NOT sent yet. The exact draft is shown to the user right after your reply and runs only if they answer y. Reply with one short line (e.g. "here\'s the draft"); do not repeat the draft or say it was sent.',
    },
}

export interface ActionToolset {
    tools: Tool[]
    /** The proposal made during this turn, if any (the last one wins). */
    proposal(): Proposal | null
}

/** Action tools bound to one chat. Add alongside the read tools when Google is connected. */
export function actionToolsFor(chatGuid: string): ActionToolset {
    let last: Proposal | null = null
    const propose = async (ctx: UserContext, kind: PendingKind, payload: Record<string, unknown>): Promise<ToolResult> => {
        try {
            const id = await storeProposal(chatGuid, ctx, kind, payload)
            last = { id, kind, payload }
            return PROPOSED
        } catch (err) {
            return { success: false, error: err instanceof Error ? err.message : String(err) }
        }
    }

    const emailSend: Tool = {
        name: 'email_send',
        description:
            "Draft an email to send from the user's Gmail. Does not send by itself: the user sees the exact draft and must confirm with y.",
        inputSchema: gmailSend.inputSchema,
        execute: (input, ctx) => {
            const i = (input ?? {}) as Record<string, unknown>
            if (!str(i.to) || !str(i.subject) || !str(i.body)) return Promise.resolve({ success: false, error: 'to, subject and body are required' })
            return propose(ctx, 'gmail_send', { to: str(i.to), subject: str(i.subject), body: str(i.body) })
        },
    }

    const emailReply: Tool = {
        name: 'email_reply',
        description:
            'Draft a reply in an existing Gmail thread (threadId + messageId from gmail_search/gmail_read). Does not send by itself: the user must confirm with y.',
        inputSchema: {
            type: 'object',
            properties: {
                ...(gmailReply.inputSchema.properties as Record<string, unknown>),
                replyToFrom: { type: 'string', description: 'Who the reply goes to, for the confirmation preview' },
            },
            required: ['threadId', 'messageId', 'body'],
        },
        execute: (input, ctx) => {
            const i = (input ?? {}) as Record<string, unknown>
            if (!str(i.threadId) || !str(i.messageId) || !str(i.body)) return Promise.resolve({ success: false, error: 'threadId, messageId and body are required' })
            return propose(ctx, 'gmail_reply', { threadId: str(i.threadId), messageId: str(i.messageId), body: str(i.body), replyToFrom: str(i.replyToFrom) })
        },
    }

    // Own-calendar events go straight through; invites to others need a yes.
    const calendarCreate: Tool = {
        name: 'gcal_create_event',
        description:
            "Create an event on the user's calendar. Runs immediately when there are no attendees. With attendees, invites go out as the user, so it becomes a draft the user confirms with y. Use the user's timezone for ISO times.",
        inputSchema: gcalCreateEvent.inputSchema,
        execute: (input, ctx) => {
            const i = (input ?? {}) as Record<string, unknown>
            const attendees = Array.isArray(i.attendees) ? (i.attendees as unknown[]).filter((a) => typeof a === 'string' && a) : []
            if (attendees.length === 0) {
                const { attendees: _drop, ...own } = i
                void _drop
                return gcalCreateEvent.execute(own, ctx)
            }
            return propose(ctx, 'gcal_create_invite', { ...i, attendees })
        },
    }

    return {
        tools: [emailSend, emailReply, calendarCreate, gcalUpdateEvent, gcalGetEvent, gcalFindFreeTime],
        proposal: () => last,
    }
}

export async function hasPendingAction(chatGuid: string): Promise<boolean> {
    const { data, error } = await createServerClient().rpc('peek_pending_action', { p_chat_guid: chatGuid })
    if (error) throw new Error(`peek_pending_action failed: ${error.message}`)
    return Array.isArray(data) && data.length > 0
}

export async function cancelPendingActions(chatGuid: string): Promise<number> {
    const { data, error } = await createServerClient().rpc('cancel_pending_actions', { p_chat_guid: chatGuid })
    if (error) throw new Error(`cancel_pending_actions failed: ${error.message}`)
    return (data as number) ?? 0
}

/**
 * Run the chat's open proposal after a "yes". Exactly once (atomic claim),
 * only against the user who proposed it. Returns whether it succeeded, the
 * executed kind/payload (for the .ics attachment), and the text to send.
 */
export async function executePendingActionDetailed(
    chatGuid: string,
    ctx: UserContext | null
): Promise<{ ok: boolean; text: string; kind: PendingKind | null; payload: Record<string, unknown> | null }> {
    const supabase = createServerClient()
    const { data, error } = await supabase.rpc('claim_pending_action', { p_chat_guid: chatGuid })
    if (error) throw new Error(`claim_pending_action failed: ${error.message}`)
    const row = (Array.isArray(data) ? data[0] : null) as
        | { id: string; user_id: string; kind: PendingKind; payload: Record<string, unknown> }
        | null
    if (!row) return { ok: false, text: 'that draft expired - ask me again and i\'ll redo it.', kind: null, payload: null }

    const finish = (status: 'done' | 'failed', result: unknown) =>
        supabase.rpc('finish_pending_action', { p_id: row.id, p_status: status, p_result: result as object })

    if (!ctx || ctx.userId !== row.user_id || (row.kind !== 'computer_browse' && !ctx.tokens.google)) {
        await finish('failed', { error: 'account not connected for this chat' })
        return {
            ok: false,
            text: "couldn't send - your google account isn't connected anymore.",
            kind: row.kind,
            payload: row.payload,
        }
    }

    // Logged-in browsing runs through the sandbox browser, not a Google
    // tool — dispatched lazily to avoid a circular import with the tools.
    if (row.kind === 'computer_browse') {
        const { runApprovedBrowse } = await import('@/lib/tools/computer')
        let result: ToolResult
        try {
            result = await runApprovedBrowse(
                {
                    task: str(row.payload.task),
                    urls: Array.isArray(row.payload.urls) ? (row.payload.urls as string[]) : [],
                },
                ctx
            )
        } catch (err) {
            result = { success: false, error: err instanceof Error ? err.message : String(err) }
        }
        await finish(result.success ? 'done' : 'failed', result.success ? result.data ?? {} : { error: result.error })
        if (!result.success) {
            return { ok: false, text: `that didn't go through: ${result.error ?? 'unknown error'}`, kind: row.kind, payload: row.payload }
        }
        const answer = str((result.data as { output?: string } | undefined)?.output).trim()
        return { ok: true, text: answer ? `browsing done:\n\n${answer}` : 'browsing done.', kind: row.kind, payload: row.payload }
    }

    const tool = row.kind === 'gmail_send' ? gmailSend : row.kind === 'gmail_reply' ? gmailReply : gcalCreateEvent
    const input =
        row.kind === 'gmail_reply'
            ? { threadId: row.payload.threadId, messageId: row.payload.messageId, body: row.payload.body }
            : row.kind === 'gcal_create_invite'
              ? { ...row.payload, sendUpdates: 'all' }
              : row.payload
    let result: ToolResult
    try {
        result = await tool.execute(input, ctx)
    } catch (err) {
        result = { success: false, error: err instanceof Error ? err.message : String(err) }
    }
    await finish(result.success ? 'done' : 'failed', result.success ? result.data ?? {} : { error: result.error })
    if (!result.success) {
        return { ok: false, text: `that didn't go through: ${result.error ?? 'unknown error'}`, kind: row.kind, payload: row.payload }
    }
    if (row.kind === 'gmail_send') return { ok: true, text: `sent to ${str(row.payload.to)}.`, kind: row.kind, payload: row.payload }
    if (row.kind === 'gmail_reply') return { ok: true, text: 'reply sent.', kind: row.kind, payload: row.payload }
    return { ok: true, text: 'event created and invites sent.', kind: row.kind, payload: row.payload }
}

/** Run the chat's open proposal after a "yes". Returns the text to send back. */
export async function executePendingAction(chatGuid: string, ctx: UserContext | null): Promise<string> {
    return (await executePendingActionDetailed(chatGuid, ctx)).text
}

/**
 * Acknowledge a confirmed action with a 👍 reaction on the user's
 * confirmation message (C4). The SDK Message carries react() when the
 * platform supports reactions; otherwise a standalone 👍 text goes out.
 * Never throws into the reply path.
 */
export async function sendConfirmedReaction(
    message: unknown,
    fallback: () => Promise<void>
): Promise<void> {
    try {
        const react = (message as { react?: (emoji: string) => Promise<unknown> } | null)?.react
        if (typeof react === 'function') {
            await react.call(message, '👍')
            return
        }
    } catch {
        // fall through to the plain-text 👍
    }
    await fallback()
}
