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
import { googleAccountsOf, multiAccount, resolveAccount, withAccount, type GoogleAccount } from '@/lib/integrations/google-accounts'

export type PendingKind = 'gmail_send' | 'gmail_reply' | 'gcal_create_invite' | 'computer_browse' | 'google_disconnect'

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

const ACCOUNT_INPUT = {
    type: 'string',
    description: 'Which Google account to act from (email address or part of it). Omit for the primary.',
}

/**
 * The account a draft will act from. With one account there is nothing to
 * pick (null, payload unchanged). With several: the named one, else the
 * primary for new mail/events, else (replies) an error asking which.
 */
export function draftAccount(
    ctx: UserContext,
    named: unknown,
    fallback: 'primary' | 'required'
): { account: GoogleAccount | null; error?: string } {
    const accounts = googleAccountsOf(ctx)
    if (accounts.length <= 1) return { account: null }
    const list = accounts.map((a) => a.email).join(', ')
    const picked = resolveAccount(accounts, named)
    if (picked === 'ambiguous') return { account: null, error: `"${str(named)}" matches more than one account: ${list}` }
    if (picked) return { account: picked }
    if (named) return { account: null, error: `no connected account matches "${str(named)}". connected: ${list}` }
    if (fallback === 'primary') return { account: accounts[0] }
    return { account: null, error: `several accounts are connected (${list}); pass account = the one the thread came from (search/read results name it)` }
}

function withAccountInput(schema: Tool['inputSchema']): Tool['inputSchema'] {
    const props = ((schema as { properties?: Record<string, unknown> } | undefined)?.properties ?? {}) as Record<string, unknown>
    return { ...schema, properties: { ...props, account: ACCOUNT_INPUT } }
}

const fromLine = (x: Record<string, unknown>): string => (x.account ? `From: ${str(x.account)}\n` : '')

/** The exact draft the user confirms, rendered by the server (not the model). */
export function renderProposal(p: Proposal): string {
    const x = p.payload
    if (p.kind === 'gmail_send') {
        return `Send this email?\n\n${fromLine(x)}To: ${str(x.to)}\nSubject: ${str(x.subject)}\n\n${str(x.body)}\n\nReply Y to send, N to cancel.`
    }
    if (p.kind === 'gmail_reply') {
        return `Send this reply${x.replyToFrom ? ` to ${str(x.replyToFrom)}` : ''}?\n\n${x.account ? `From: ${str(x.account)}\n\n` : ''}${str(x.body)}\n\nReply Y to send, N to cancel.`
    }
    if (p.kind === 'google_disconnect') {
        return `Disconnect ${str(x.account)} from Dinghy?\n\nI'll stop reading its email and calendar. You can connect it again any time.\n\nReply Y to disconnect, N to cancel.`
    }
    const attendees = Array.isArray(x.attendees) ? (x.attendees as string[]).join(', ') : ''
    if (p.kind === 'computer_browse') {
        const domains = (Array.isArray(x.urls) ? (x.urls as string[]) : []).join(', ')
        return `Browse${domains ? ` ${domains}` : ''} for you while logged in?\n\n${str(x.task)}\n\nReply Y to run it, N to cancel.`
    }
    return `Create this event and send invites?\n\n${x.account ? `On: ${str(x.account)}\n` : ''}${str(x.summary)}\n${str(x.start)} to ${str(x.end)}${x.location ? `\n${str(x.location)}` : ''}\nInvites: ${attendees}\n\nReply Y to send, N to cancel.`
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
        inputSchema: withAccountInput(gmailSend.inputSchema),
        execute: (input, ctx) => {
            const i = (input ?? {}) as Record<string, unknown>
            if (!str(i.to) || !str(i.subject) || !str(i.body)) return Promise.resolve({ success: false, error: 'to, subject and body are required' })
            const { account, error } = draftAccount(ctx, i.account, 'primary')
            if (error) return Promise.resolve({ success: false, error })
            return propose(ctx, 'gmail_send', { to: str(i.to), subject: str(i.subject), body: str(i.body), ...(account ? { account: account.email } : {}) })
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
                account: ACCOUNT_INPUT,
            },
            required: ['threadId', 'messageId', 'body'],
        },
        execute: (input, ctx) => {
            const i = (input ?? {}) as Record<string, unknown>
            if (!str(i.threadId) || !str(i.messageId) || !str(i.body)) return Promise.resolve({ success: false, error: 'threadId, messageId and body are required' })
            const { account, error } = draftAccount(ctx, i.account, 'required')
            if (error) return Promise.resolve({ success: false, error })
            return propose(ctx, 'gmail_reply', {
                threadId: str(i.threadId),
                messageId: str(i.messageId),
                body: str(i.body),
                replyToFrom: str(i.replyToFrom),
                ...(account ? { account: account.email } : {}),
            })
        },
    }

    // Own-calendar events go straight through; invites to others need a yes.
    const calendarCreate: Tool = {
        name: 'gcal_create_event',
        description:
            "Create an event on the user's calendar. Runs immediately when there are no attendees. With attendees, invites go out as the user, so it becomes a draft the user confirms with y. Use the user's timezone for ISO times.",
        inputSchema: withAccountInput(gcalCreateEvent.inputSchema),
        execute: (input, ctx) => {
            const { account: named, ...i } = (input ?? {}) as Record<string, unknown>
            const { account, error } = draftAccount(ctx, named, 'primary')
            if (error) return Promise.resolve({ success: false, error })
            const attendees = Array.isArray(i.attendees) ? (i.attendees as unknown[]).filter((a) => typeof a === 'string' && a) : []
            if (attendees.length === 0) {
                const { attendees: _drop, ...own } = i
                void _drop
                return gcalCreateEvent.execute(own, account ? withAccount(ctx, account) : ctx)
            }
            return propose(ctx, 'gcal_create_invite', { ...i, attendees, ...(account ? { account: account.email } : {}) })
        },
    }

    // Account management: list, switch primary (instant, reversible),
    // disconnect (a y-confirmed draft).
    const accountsList: Tool = {
        name: 'google_accounts',
        description: 'List the Google (Gmail + Calendar) accounts the user has connected and which is primary.',
        inputSchema: { type: 'object', properties: {} },
        execute: async (_input, ctx) => ({
            success: true,
            data: { accounts: googleAccountsOf(ctx).map((a) => ({ email: a.email, primary: a.primary })) },
        }),
    }
    const accountsPrimary: Tool = {
        name: 'google_set_primary',
        description: 'Make one connected Google account the primary (the default for new emails and events). Only when the user asks.',
        inputSchema: { type: 'object', properties: { account: ACCOUNT_INPUT }, required: ['account'] },
        execute: async (input, ctx) => {
            const accounts = googleAccountsOf(ctx)
            const picked = resolveAccount(accounts, (input as Record<string, unknown> | null)?.account)
            if (!picked || picked === 'ambiguous') return { success: false, error: `pick one of: ${accounts.map((a) => a.email).join(', ')}` }
            if (picked.primary) return { success: true, data: { primary: picked.email, changed: false } }
            const { setPrimaryGoogleAccount } = await import('@/lib/integrations/google')
            const ok = await setPrimaryGoogleAccount(ctx.userId, picked.email)
            return ok ? { success: true, data: { primary: picked.email, changed: true } } : { success: false, error: `${picked.email} isn't connected` }
        },
    }
    const accountsDisconnect: Tool = {
        name: 'google_disconnect',
        description: 'Disconnect one Google account. Does not run by itself: the user must confirm with y.',
        inputSchema: { type: 'object', properties: { account: ACCOUNT_INPUT }, required: ['account'] },
        execute: (input, ctx) => {
            const accounts = googleAccountsOf(ctx)
            const picked = resolveAccount(accounts, (input as Record<string, unknown> | null)?.account)
            if (!picked || picked === 'ambiguous') return Promise.resolve({ success: false, error: `pick one of: ${accounts.map((a) => a.email).join(', ')}` })
            return propose(ctx, 'google_disconnect', { account: picked.email })
        },
    }

    return {
        tools: [accountsList, accountsPrimary, accountsDisconnect, emailSend, emailReply, calendarCreate, multiAccount(gcalUpdateEvent, 'find'), multiAccount(gcalGetEvent, 'find'), multiAccount(gcalFindFreeTime, 'all')],
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
    if (!row) return { ok: false, text: 'That draft expired. Ask me again and I\'ll redo it.', kind: null, payload: null }

    const finish = (status: 'done' | 'failed', result: unknown) =>
        supabase.rpc('finish_pending_action', { p_id: row.id, p_status: status, p_result: result as object })

    if (!ctx || ctx.userId !== row.user_id || (row.kind !== 'computer_browse' && !ctx.tokens.google)) {
        await finish('failed', { error: 'account not connected for this chat' })
        return {
            ok: false,
            text: "Couldn't send - your Google account isn't connected anymore.",
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
            return { ok: false, text: `That didn't go through: ${result.error ?? 'unknown error'}`, kind: row.kind, payload: row.payload }
        }
        const answer = str((result.data as { output?: string } | undefined)?.output).trim()
        return { ok: true, text: answer ? `Browsing done:\n\n${answer}` : 'Browsing done.', kind: row.kind, payload: row.payload }
    }

    if (row.kind === 'google_disconnect') {
        const email = str(row.payload.account)
        let ok = false
        try {
            const { disconnectGoogleAccount } = await import('@/lib/integrations/google')
            ok = await disconnectGoogleAccount(ctx.userId, email)
        } catch (err) {
            await finish('failed', { error: err instanceof Error ? err.message : String(err) })
            return { ok: false, text: `Couldn't disconnect ${email}. Try again in a moment.`, kind: row.kind, payload: row.payload }
        }
        await finish(ok ? 'done' : 'failed', ok ? { disconnected: email } : { error: 'not connected' })
        return { ok, text: ok ? `Disconnected ${email}.` : `${email} wasn't connected.`, kind: row.kind, payload: row.payload }
    }

    // Multi-account drafts carry the account they were shown with; run from
    // exactly that one or not at all.
    let runCtx: UserContext = ctx
    const draftEmail = str(row.payload.account)
    if (draftEmail) {
        const acct = googleAccountsOf(ctx).find((a) => a.email === draftEmail.toLowerCase())
        if (!acct) {
            await finish('failed', { error: `account ${draftEmail} not connected` })
            return { ok: false, text: `Couldn't send - ${draftEmail} isn't connected anymore.`, kind: row.kind, payload: row.payload }
        }
        runCtx = withAccount(ctx, acct)
    }
    const { account: _acct, ...payload } = row.payload
    void _acct

    const tool = row.kind === 'gmail_send' ? gmailSend : row.kind === 'gmail_reply' ? gmailReply : gcalCreateEvent
    const input =
        row.kind === 'gmail_reply'
            ? { threadId: payload.threadId, messageId: payload.messageId, body: payload.body }
            : row.kind === 'gcal_create_invite'
              ? { ...payload, sendUpdates: 'all' }
              : payload
    let result: ToolResult
    try {
        result = await tool.execute(input, runCtx)
    } catch (err) {
        result = { success: false, error: err instanceof Error ? err.message : String(err) }
    }
    await finish(result.success ? 'done' : 'failed', result.success ? result.data ?? {} : { error: result.error })
    if (!result.success) {
        return { ok: false, text: `That didn't go through: ${result.error ?? 'unknown error'}`, kind: row.kind, payload: row.payload }
    }
    if (row.kind === 'gmail_send') return { ok: true, text: `Sent to ${str(row.payload.to)}.`, kind: row.kind, payload: row.payload }
    if (row.kind === 'gmail_reply') return { ok: true, text: 'Reply sent.', kind: row.kind, payload: row.payload }
    return { ok: true, text: 'Event created and invites sent.', kind: row.kind, payload: row.payload }
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
    fallback: () => Promise<void>,
    emoji = '✅'
): Promise<void> {
    try {
        const react = (message as { react?: (emoji: string) => Promise<unknown> } | null)?.react
        if (typeof react === 'function') {
            await react.call(message, emoji)
            return
        }
    } catch {
        // fall through to the plain-text 👍
    }
    await fallback()
}
