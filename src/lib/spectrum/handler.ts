/**
 * Inbound message handling for the webhook route, ported from
 * src/spectrum/index.ts. Runs after the HTTP response (the SDK invokes the
 * handler fire-and-forget), so every send goes through the outbox: enqueue
 * first, send, mark sent — a kill mid-flight leaves a pending row for the
 * sweep.
 */

import { typing } from 'spectrum-ts'
import {
    ensureIdentity,
    isGoogleConnected,
    isPayboxConnected,
    isGithubConnected,
    isHealthConnected,
    loadFacts,
    loadHistory,
    saveMessage,
    fileMarker,
    createConnectLink,
    type DinghyFact,
    type HistoryMessage,
} from '@/spectrum/store'
import { chat, chatWithTools, productFactsFor, wantsGoogle, wantsGithub, wantsHealth, wantsWallet, isContactCardRequest, MAX_HISTORY, type Message } from './dinghy'
import { recordUsage, spendToolFor, type GatewayUsage } from './metering'
import { capabilitiesFor, guestCapabilities, guestToolContext, liveInfoTools, loadImessageToolContext, toolsFor } from './imessage-tools'
import { reminderToolsFor } from './reminders'
import { payboxSigningToolsFor } from '@/lib/tools/paybox-signing'
import { EMPTY_MEMORY, loadMemoryContext, renderMemoryBlock, updateMemory } from './memory'
import { FILE_NUDGE, fileToolsFor, stripFileMarkers, type MadeFile } from '@/lib/files/tool'
import { sendFileWithPreview } from '@/lib/files/send'
import { actionToolsFor, cancelPendingActions, executePendingActionDetailed, hasPendingAction, parseConfirmation, renderProposal, sendConfirmedReaction } from './actions'
import { GATEWAY_URL, SHIPYARD_API_KEY, SHIPYARD_MODEL } from './config'
import { dinghyContactCard } from './contact-card'
import { hitRateLimit, RATE_NOTICE } from './rate-limit'
import {
    claimGateNotice,
    extractInviteCode,
    getBetaRole,
    mintInvite,
    parseInviteCommand,
    redeemInvite,
    GATE_INVALID,
    GATE_NOTICE,
    GATE_WELCOME,
    type BetaRole,
} from './beta-gate'
import { claimInboundDelivery, enqueueOutbox, markOutboxFailed, markOutboxSent, type OutboxKind } from './outbox'
import { briefableUserId, handleMuteIntent } from './briefing'
import { isLocationAttachment, parseLocation, saveUserLocation } from './location'
import {
    forgetMatch,
    handlePendingMemoryWipe,
    isMemoryCommand,
    parseForgetIntent,
    renderMemoryReport,
    requestMemoryWipe,
    WIPE_PROMPT,
} from './memory-commands'
import { buildIcs } from './ics'
import { interviewDirective, markOpenerAsked } from './interview'
import { attachment } from 'spectrum-ts'

export interface InboundSpace {
    /** Webhook SDK space objects carry the chat identifier as `id`. */
    id?: string
    /** Stream SDK space objects (src/spectrum/index.ts) carry it as `guid`. */
    guid?: string
    send(text: string): Promise<unknown>
}

export interface InboundMessage {
    id?: string
    content: { type: string; text?: string }
    sender?: { handle?: string; id?: string }
}

/**
 * The chat identifier for persistence. Webhook deliveries expose the space
 * id (Zod-required string); the legacy stream shape used `guid`. Returns
 * null only for a shape no Spectrum transport produces.
 */
export function resolveChatGuid(space: InboundSpace): string | null {
    return space.id ?? space.guid ?? null
}

function logErr(context: string, err: unknown): void {
    console.error(`${context}:`, err instanceof Error ? err.message : String(err))
}

type ContentSender = InboundSpace & { send(content: unknown): Promise<unknown> }

/** Typing indicator while the LLM call is in flight. Fire-and-forget: a
 *  typing failure must never block or kill the reply path. */
function startTyping(space: InboundSpace): void {
    void (space as ContentSender)
        .send(typing())
        .catch((err) => logErr('typing start failed', err))
}

function stopTyping(space: InboundSpace): void {
    void (space as ContentSender)
        .send(typing('stop'))
        .catch((err) => logErr('typing stop failed', err))
}

/**
 * Presence: the iMessage typing indicator decays after a few seconds, but
 * multi-tool turns can run for a minute+. Re-tap typing every 5s while the
 * turn runs. Never throws into the reply path: every tap is .catch'd, and
 * stopTypingReTap is safe to call any number of times.
 */
function startTypingReTap(space: InboundSpace): ReturnType<typeof setInterval> {
    startTyping(space)
    const handle = setInterval(() => startTyping(space), 5_000)
    // Keep the interval from holding the process open (serverless tails).
    handle.unref?.()
    return handle
}

function stopTypingReTap(space: InboundSpace, handle: ReturnType<typeof setInterval> | null): void {
    if (handle) clearInterval(handle)
    stopTyping(space)
}

/** Native .ics attachment for a just-confirmed calendar invite. Best-effort:
 *  a failure is logged, never surfaced into the reply path. */
async function sendIcsAttachment(space: InboundSpace, payload: Record<string, unknown>): Promise<void> {
    const summary = typeof payload.summary === 'string' ? payload.summary : 'event'
    const start = typeof payload.start === 'string' ? payload.start : ''
    const end = typeof payload.end === 'string' ? payload.end : start
    if (!start) return
    const attendees = Array.isArray(payload.attendees) ? payload.attendees.filter((a): a is string => typeof a === 'string' && a.includes('@')) : []
    const ics = buildIcs({
        summary,
        start,
        end,
        attendees,
        location: typeof payload.location === 'string' ? payload.location : undefined,
    })
    await (space as ContentSender).send(attachment(ics, { name: 'event.ics', mimeType: 'text/calendar' }))
}

/** Enqueue-then-send: the row exists before the attempt, so a kill or a
 *  send failure is always retried by the sweep. */
/** Native attachment; on failure, fall back to the signed link as text. */
async function sendFile(space: InboundSpace, chatGuid: string, file: MadeFile): Promise<void> {
    try {
        await sendFileWithPreview(space as ContentSender, file)
        await saveMessage(chatGuid, 'assistant', fileMarker(file.filename)).catch((err) => logErr('message save failed', err))
    } catch (err) {
        logErr('file send failed', err)
        const fallback = file.link
            ? `${file.title}: ${file.link}`
            : `I made ${file.filename} but couldn't send it. Ask me again in a moment.`
        await sendText(space, chatGuid, 'reply', fallback)
        await saveMessage(chatGuid, 'assistant', fallback).catch((e) => logErr('message save failed', e))
    }
}

async function sendText(space: InboundSpace, chatGuid: string, kind: OutboxKind, text: string): Promise<void> {
    const outboxId = await enqueueOutbox(chatGuid, kind, text)
    try {
        await space.send(text)
        if (outboxId) await markOutboxSent(outboxId)
    } catch (err) {
        if (outboxId) {
            await markOutboxFailed(
                { id: outboxId, chat_guid: chatGuid, kind, text, attempts: 0 },
                err
            )
        } else {
            logErr('send failed and outbox enqueue failed (untracked)', err)
        }
    }
}

/** A message from a chat that isn't on the beta allowlist. */
async function handleGatedMessage(space: InboundSpace, chatGuid: string, text: string): Promise<void> {
    try {
        const code = extractInviteCode(text)
        if (code) {
            const result = await redeemInvite(chatGuid, code)
            if (result === 'ok' || result === 'already') {
                await sendText(space, chatGuid, 'reply', GATE_WELCOME)
                await (space as InboundSpace & { send(b: unknown): Promise<unknown> })
                    .send(dinghyContactCard())
                    .catch((err) => logErr('welcome contact card failed', err))
            } else if (result === 'invalid') {
                await sendText(space, chatGuid, 'reply', GATE_INVALID)
            }
            // locked: stay silent until the lockout expires.
            return
        }
        if (await claimGateNotice(chatGuid)) {
            await sendText(space, chatGuid, 'reply', GATE_NOTICE)
        }
    } catch (err) {
        logErr('beta gate failed', err)
    }
}

export const LOCATION_ACK = "got it. I'll use that for your morning weather."

/**
 * A shared location (iMessage "Send My Current Location", a dropped maps
 * pin, or a bare maps link) from a bound chat becomes that person's current
 * spot for the morning brief. Returns true when the message was handled.
 * Only the chat's own bound user is updated, and only from their own thread.
 */
async function maybeHandleLocationShare(space: InboundSpace, message: InboundMessage): Promise<boolean> {
    const c = message.content as { type: string; name?: string; mimeType?: string; read?: () => Promise<Buffer>; url?: string; text?: string }
    let body: string | null = null
    if (c.type === 'attachment' && c.read && isLocationAttachment(c.name ?? '', c.mimeType ?? '')) {
        body = (await c.read().catch(() => Buffer.from(''))).toString('utf8')
    } else if (c.type === 'richlink' && typeof c.url === 'string') {
        body = c.url
    } else if (c.type === 'text' && typeof c.text === 'string' && /^\s*\S*(maps\.apple\.com|google\.[a-z.]+\/maps|geo:)\S*\s*$/i.test(c.text)) {
        body = c.text
    }
    if (!body) return false
    const loc = parseLocation(body)
    if (!loc) return false
    const chatGuid = resolveChatGuid(space)
    if (!chatGuid) return true
    if (message.id && !(await claimInboundDelivery(message.id, chatGuid))) return true
    const userId = await briefableUserId(chatGuid).catch(() => null)
    if (!userId) return true
    if (await saveUserLocation(userId, loc)) await sendText(space, chatGuid, 'reply', LOCATION_ACK)
    return true
}

export async function handleSpectrumMessage(space: InboundSpace, message: InboundMessage): Promise<void> {
    try {
        if (await maybeHandleLocationShare(space, message)) return
    } catch (err) {
        logErr('location share failed', err)
    }
    if (message.content.type !== 'text' || !message.content.text) return
    const text = message.content.text.trim()
    if (!text) return

    const chatGuid = resolveChatGuid(space)
    if (!chatGuid) {
        logErr('inbound message dropped', new Error('space carries neither id nor guid'))
        return
    }

    // Exactly-once: Spectrum delivery is at-least-once, dedupe on message.id.
    if (message.id) {
        const isNew = await claimInboundDelivery(message.id, chatGuid)
        if (!isNew) return
    }

    await ensureIdentity(chatGuid, message.sender?.handle ?? message.sender?.id ?? null).catch((err) =>
        logErr('identity ensure failed', err)
    )

    // Private-beta gate: only allowlisted chats reach Dinghy. Fails closed
    // (silently) when the allowlist can't be read.
    let role: BetaRole | null
    try {
        role = await getBetaRole(chatGuid)
    } catch (err) {
        logErr('beta gate unavailable (message not processed)', err)
        return
    }

    // Per-chat rate limit (owner exempt), before any LLM or gate work.
    if (role !== 'owner') {
        const rate = await hitRateLimit(chatGuid)
        if (rate !== 'ok') {
            if (rate === 'limited_notify' && role) await sendText(space, chatGuid, 'reply', RATE_NOTICE)
            return
        }
    }

    if (!role) {
        await handleGatedMessage(space, chatGuid, text)
        return
    }

    // Owner: mint an invite code ("invite", "invite 5").
    if (role === 'owner') {
        const uses = parseInviteCommand(text)
        if (uses !== null) {
            try {
                const code = await mintInvite(chatGuid, uses)
                await sendText(
                    space,
                    chatGuid,
                    'reply',
                    code
                        ? `invite code: ${code} (${uses} use${uses === 1 ? '' : 's'}, expires in 30 days). they text it to this number.`
                        : "couldn't mint that invite."
                )
                if (code) await sendText(space, chatGuid, 'reply', code)
            } catch (err) {
                logErr('invite mint failed', err)
                await sendText(space, chatGuid, 'error_notice', "couldn't mint an invite - try again in a moment.")
            }
            return
        }
    }

    // On-demand contact card.
    if (isContactCardRequest(text)) {
        await (space as InboundSpace & { send(b: unknown): Promise<unknown> })
            .send(dinghyContactCard())
            .catch((err) => logErr('contact card failed', err))
        return
    }

    const t0 = Date.now()
    // Memory loads in parallel with history; any failure means no memory.
    const memoryP = loadMemoryContext(chatGuid, text).catch((err) => {
        logErr('memory load failed', err)
        return EMPTY_MEMORY
    })
    // A DB blip degrades to no-history, never a dead tail.
    const history = await loadHistory(chatGuid, MAX_HISTORY).catch((err) => {
        logErr('history load failed', err)
        return [] as HistoryMessage[]
    })
    const facts = productFactsFor(
        role,
        await loadFacts().catch((err) => {
            logErr('facts load failed', err)
            return [] as DinghyFact[]
        })
    )
    const memory = await memoryP
    const memoryBlock = renderMemoryBlock(memory)
    const tContext = Date.now()
    // The opener is for a genuinely new chat only: no history and no
    // profile. dinghy_facts are product-wide context (every chat has them),
    // so they no longer suppress it.
    const includeOpener = history.length === 0 && !memory.profile
    // Day-1 interview (F2): when the opener's answer arrives, at most two
    // short follow-ups go out over separate turns (skipped if already
    // answered); answers land as profile facts via the memory write path.
    // State failure ends the interview, never the reply.
    if (includeOpener) {
        await markOpenerAsked(chatGuid).catch((err) => logErr('interview opener mark failed', err))
    }
    const interviewLine =
        history.length > 0
            ? await interviewDirective(chatGuid, history[0]?.content ?? '', text).catch((err) => {
                  logErr('interview step failed', err)
                  return null
              })
            : null

    // First-ever message in this chat: onboarding contact card. DB-backed
    // (was a process-memory Set on the VPS) so it works statelessly. Our own
    // vCard, not nativeContactCard(): the shared line's native card is the
    // pool's "Spectrum" identity.
    if (history.length === 0) {
        await (space as InboundSpace & { send(b: unknown): Promise<unknown> })
            .send(dinghyContactCard())
            .catch((err) => logErr('onboarding contact card failed', err))
    }

    // Gmail/Calendar requested while unconnected: one-use connect link.
    if (wantsGoogle(text) && !(await isGoogleConnected(chatGuid).catch(() => false))) {
        try {
            const link = await createConnectLink(chatGuid, text)
            await saveMessage(chatGuid, 'user', text).catch((err) => logErr('message save failed', err))
            // URL goes out as its own bubble: iMessage renders the rich
            // link-preview card (OG from /connect) only when the URL stands
            // alone.
            await sendText(
                space,
                chatGuid,
                'connect_link',
                "email + calendar aren't connected yet - tap below to connect google and i'll take it from there:"
            )
            await sendText(space, chatGuid, 'connect_link', link)
        } catch (err) {
            logErr('connect link failed', err)
            await sendText(space, chatGuid, 'error_notice', "couldn't start the connect flow - try again in a moment.")
        }
        return
    }

    // GitHub asked about while unconnected: one-use GitHub connect link.
    if (wantsGithub(text) && !(await isGithubConnected(chatGuid).catch(() => false))) {
        try {
            const link = await createConnectLink(chatGuid, text, 'github')
            await saveMessage(chatGuid, 'user', text).catch((err) => logErr('message save failed', err))
            await sendText(
                space,
                chatGuid,
                'connect_link',
                "github isn't connected yet - tap below to connect it (i'll only read repos, issues and PRs) and i'll take it from there:"
            )
            await sendText(space, chatGuid, 'connect_link', link)
        } catch (err) {
            logErr('github connect link failed', err)
            await sendText(space, chatGuid, 'error_notice', "couldn't start the connect flow - try again in a moment.")
        }
        return
    }

    // Sleep/recovery asked about with no wearable connected: Oura + WHOOP links.
    if (wantsHealth(text) && !(await isHealthConnected(chatGuid).catch(() => false))) {
        try {
            const oura = await createConnectLink(chatGuid, text, 'oura')
            const whoop = await createConnectLink(chatGuid, text, 'whoop')
            await saveMessage(chatGuid, 'user', text).catch((err) => logErr('message save failed', err))
            await sendText(
                space,
                chatGuid,
                'connect_link',
                "no wearable connected yet - tap whichever you use (read-only: sleep, recovery, activity) and i'll take it from there. oura:"
            )
            await sendText(space, chatGuid, 'connect_link', oura)
            await sendText(space, chatGuid, 'connect_link', 'whoop:')
            await sendText(space, chatGuid, 'connect_link', whoop)
        } catch (err) {
            logErr('health connect link failed', err)
            await sendText(space, chatGuid, 'error_notice', "couldn't start the connect flow - try again in a moment.")
        }
        return
    }

    // Wallet asked about while PayBox is unconnected: one-use PayBox connect link.
    if (wantsWallet(text) && !(await isPayboxConnected(chatGuid).catch(() => false))) {
        try {
            const link = await createConnectLink(chatGuid, text, 'paybox')
            await saveMessage(chatGuid, 'user', text).catch((err) => logErr('message save failed', err))
            await sendText(
                space,
                chatGuid,
                'connect_link',
                "your wallet isn't connected yet - tap below to connect paybox (email + passkey, read-only for now) and i'll take it from there:"
            )
            await sendText(space, chatGuid, 'connect_link', link)
        } catch (err) {
            logErr('paybox connect link failed', err)
            await sendText(space, chatGuid, 'error_notice', "couldn't start the connect flow - try again in a moment.")
        }
        return
    }

    // Morning briefing mute intent: the digest footer's exact opt-out
    // ("mute mornings"), plus its mirror "unmute mornings". Checked before
    // the pending-action parse so it works even with a draft open.
    const muteAck = await handleMuteIntent(chatGuid, text).catch((err) => {
        logErr('briefing mute intent failed', err)
        return null
    })
    if (muteAck) {
        await saveMessage(chatGuid, 'user', text).catch((err) => logErr('message save failed', err))
        await sendText(space, chatGuid, 'reply', muteAck)
        await saveMessage(chatGuid, 'assistant', muteAck).catch((err) => logErr('message save failed', err))
        return
    }

    // /memory transparency (F1): show exactly what is remembered. Runs
    // before the pending-action parse so it works even with a draft open.
    if (isMemoryCommand(text)) {
        await saveMessage(chatGuid, 'user', text).catch((err) => logErr('message save failed', err))
        try {
            const report = await renderMemoryReport(chatGuid)
            await sendText(space, chatGuid, 'reply', report)
            await saveMessage(chatGuid, 'assistant', report).catch((err) => logErr('message save failed', err))
        } catch (err) {
            logErr('memory report failed', err)
            await sendText(space, chatGuid, 'error_notice', "couldn't pull your memories up right now - try again in a moment.")
        }
        return
    }

    // An open "wipe everything" gate (F1) resolves on the very next message:
    // only an explicit YES wipes; anything else cancels and flows on.
    const wipeReply = await handlePendingMemoryWipe(chatGuid, text).catch((err) => {
        logErr('memory wipe gate failed', err)
        return null
    })
    if (wipeReply !== null) {
        await saveMessage(chatGuid, 'user', text).catch((err) => logErr('message save failed', err))
        await sendText(space, chatGuid, 'reply', wipeReply)
        await saveMessage(chatGuid, 'assistant', wipeReply).catch((err) => logErr('message save failed', err))
        return
    }

    // "forget X" (F1): single facts drop right away (soft delete, reversible);
    // "forget everything" opens the explicit-YES wipe gate instead.
    const forget = parseForgetIntent(text)
    if (forget) {
        await saveMessage(chatGuid, 'user', text).catch((err) => logErr('message save failed', err))
        let out: string
        if (forget.kind === 'all') {
            try {
                await requestMemoryWipe(chatGuid)
                out = WIPE_PROMPT
            } catch (err) {
                logErr('memory wipe request failed', err)
                out = "couldn't open the wipe flow - try again in a moment."
            }
        } else {
            try {
                const n = await forgetMatch(chatGuid, forget.match)
                out = n > 0 ? `forgot it${n > 1 ? ` (${n} things actually)` : ''}.` : "nothing like that on file - check '/memory' to see what i've got."
            } catch (err) {
                logErr('memory forget failed', err)
                out = "couldn't forget that just now - try again in a moment."
            }
        }
        await sendText(space, chatGuid, 'reply', out)
        await saveMessage(chatGuid, 'assistant', out).catch((err) => logErr('message save failed', err))
        return
    }

    // An open draft (email / invite) runs only on a clear yes as the very
    // next message. "no" or anything else cancels it; anything else then
    // goes through the normal path as a fresh request.
    if (await hasPendingAction(chatGuid).catch((err) => { logErr('pending action peek failed', err); return false })) {
        const answer = parseConfirmation(text)
        if (answer === 'yes') {
            await saveMessage(chatGuid, 'user', text).catch((err) => logErr('message save failed', err))
            let out: string
            let executed: Awaited<ReturnType<typeof executePendingActionDetailed>> | null = null
            try {
                const ctx = await loadImessageToolContext(chatGuid).catch(() => null)
                executed = await executePendingActionDetailed(chatGuid, ctx)
                out = executed.text
            } catch (err) {
                logErr('pending action failed', err)
                out = "that didn't go through - try again in a moment."
            }
            await sendText(space, chatGuid, 'reply', out)
            await saveMessage(chatGuid, 'assistant', out).catch((err) => logErr('message save failed', err))
            // 👍 on the confirmation itself when the action actually ran.
            if (executed?.ok) {
                await sendConfirmedReaction(message, () => sendText(space, chatGuid, 'reply', '👍')).catch((err) =>
                    logErr('confirmation reaction failed', err)
                )
                // .ics copy of the event the user just confirmed (C5).
                if (executed.kind === 'gcal_create_invite' && executed.payload) {
                    await sendIcsAttachment(space, executed.payload).catch((err) => logErr('ics attachment failed', err))
                }
            }
            return
        }
        await cancelPendingActions(chatGuid).catch((err) => logErr('pending action cancel failed', err))
        if (answer === 'no') {
            await saveMessage(chatGuid, 'user', text).catch((err) => logErr('message save failed', err))
            await sendText(space, chatGuid, 'reply', 'ok, scrapped it.')
            await saveMessage(chatGuid, 'assistant', 'ok, scrapped it.').catch((err) => logErr('message save failed', err))
            return
        }
    }

    if (!SHIPYARD_API_KEY) {
        logErr('reply failed', new Error('SHIPYARD_API_KEY is not set'))
        await sendText(space, chatGuid, 'error_notice', 'Something went wrong on my end. Try again in a moment.')
        return
    }

    const full: Message[] = [...history, { role: 'user', content: text }]
    await saveMessage(chatGuid, 'user', text).catch((err) => logErr('message save failed', err))

    const tChatStart = Date.now()
    const typingHandle = startTypingReTap(space)
    try {
        // Read tools only for chats bound to a user with Google/PayBox connected;
        // everyone else gets the plain conversational path.
        const toolCtx = await loadImessageToolContext(chatGuid).catch((err) => {
            logErr('tool context load failed', err)
            return null
        })
        let reply: string
        let toolCalls = 0
        let iterations = 0
        const actions = toolCtx && capabilitiesFor(toolCtx).google ? actionToolsFor(chatGuid) : null
        const fileTools = toolCtx ? fileToolsFor() : null
        // Unbound chats still get live info (weather, web search): public
        // data only, run against an empty context with no account tokens.
        // Every chat can ask what it has spent; the owner sees all chats.
        const spendTool = spendToolFor(chatGuid, role === 'owner')
        // Reminders for every chat; they only ever text this chat back.
        const reminderTools = reminderToolsFor(chatGuid, toolCtx?.userId ?? null, toolCtx?.timezone)
        const tools = toolCtx
            ? [...toolsFor(toolCtx), ...(actions?.tools ?? []), ...(fileTools?.tools ?? []), spendTool, ...reminderTools, ...(toolCtx.tokens.paybox ? payboxSigningToolsFor(chatGuid) : [])]
            : [...liveInfoTools(), spendTool, ...reminderTools]
        const usage: GatewayUsage[] = []
        const onUsage = (u: GatewayUsage) => usage.push(u)
        const runCtx = toolCtx ?? guestToolContext()
        if (tools.length > 0) {
            const toolOpts = {
                gatewayUrl: GATEWAY_URL,
                apiKey: SHIPYARD_API_KEY,
                model: SHIPYARD_MODEL,
                facts,
                includeOpener,
                capabilities: { ...(toolCtx ? capabilitiesFor(toolCtx) : guestCapabilities()), spend: true, reminders: true },
                memory: memoryBlock,
                interviewLine: interviewLine ?? undefined,
                onUsage,
            }
            const r = await chatWithTools(full, toolOpts, tools, runCtx)
            reply = r.reply
            toolCalls = r.toolCalls
            iterations = r.iterations
            // The model sometimes writes a "[sent file: x]" marker instead of
            // calling create_file. Give it one retry to actually make the file.
            if (stripFileMarkers(reply).hadMarker && (fileTools?.files().length ?? 0) === 0) {
                const retry = await chatWithTools(
                    [...full, { role: 'assistant', content: reply }, { role: 'user', content: FILE_NUDGE }],
                    toolOpts,
                    tools,
                    runCtx
                )
                reply = retry.reply
                toolCalls += retry.toolCalls
                iterations += retry.iterations
            }
            const cleaned = stripFileMarkers(reply)
            const made = fileTools?.files().length ?? 0
            reply = cleaned.text || (made > 0 ? 'here you go.' : "I couldn't make that file just now. Ask me again in a moment.")
            if (cleaned.hadMarker && made === 0) reply = "I couldn't make that file just now. Ask me again in a moment."
        } else {
            reply = await chat(full, {
                gatewayUrl: GATEWAY_URL,
                apiKey: SHIPYARD_API_KEY,
                model: SHIPYARD_MODEL,
                facts,
                includeOpener,
                memory: memoryBlock,
                interviewLine: interviewLine ?? undefined,
                onUsage,
            })
        }
        const tChatEnd = Date.now()
        await sendText(space, chatGuid, 'reply', reply)
        await saveMessage(chatGuid, 'assistant', reply).catch((err) => logErr('message save failed', err))
        // The exact draft, rendered by the server, as its own bubble.
        const proposal = actions?.proposal()
        if (proposal) {
            const preview = renderProposal(proposal)
            await sendText(space, chatGuid, 'reply', preview)
            await saveMessage(chatGuid, 'assistant', preview).catch((err) => logErr('message save failed', err))
        }
        // Files made this turn go out as native attachments after the text.
        for (const file of fileTools?.files() ?? []) await sendFile(space, chatGuid, file)
        // Warm-path latency ledger: read these from the function logs.
        console.log(
            `dinghy timing ${JSON.stringify({
                chatGuid,
                contextMs: tContext - t0,
                chatMs: tChatEnd - tChatStart,
                sendMs: Date.now() - tChatEnd,
                totalMs: Date.now() - t0,
                tools: tools.length,
                toolCalls,
                iterations,
            })}`
        )
        // After the reply is out: meter this turn's gateway calls. Errors are
        // logged, never surfaced; awaited so serverless doesn't drop the write.
        await recordUsage(chatGuid, 'reply', usage).catch((err) => logErr('usage record failed', err))
        // After the reply is out: refresh memory (no-op unless due).
        await updateMemory(chatGuid).catch((err) => logErr('memory update failed', err))
    } catch (err) {
        logErr('gateway call failed', err)
        await sendText(space, chatGuid, 'error_notice', 'Something went wrong on my end. Try again in a moment.')
    } finally {
        stopTypingReTap(space, typingHandle)
    }
}
