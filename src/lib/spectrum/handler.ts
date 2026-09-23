/**
 * Inbound message handling for the webhook route, ported from
 * src/spectrum/index.ts. Runs after the HTTP response (the SDK invokes the
 * handler fire-and-forget), so every send goes through the outbox: enqueue
 * first, send, mark sent — a kill mid-flight leaves a pending row for the
 * sweep.
 */

import { nativeContactCard } from '@spectrum-ts/imessage'
import {
    ensureIdentity,
    isGoogleConnected,
    loadHistory,
    saveMessage,
    createConnectLink,
} from '@/spectrum/store'
import { chat, wantsGoogle, isContactCardRequest, MAX_HISTORY, type Message } from './dinghy'
import { GATEWAY_URL, SHIPYARD_API_KEY, SHIPYARD_MODEL } from './config'
import { claimInboundDelivery, enqueueOutbox, markOutboxFailed, markOutboxSent, type OutboxKind } from './outbox'

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

/** Enqueue-then-send: the row exists before the attempt, so a kill or a
 *  send failure is always retried by the sweep. */
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

export async function handleSpectrumMessage(space: InboundSpace, message: InboundMessage): Promise<void> {
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

    // On-demand contact card.
    if (isContactCardRequest(text)) {
        await (space as InboundSpace & { send(b: unknown): Promise<unknown> })
            .send(nativeContactCard())
            .catch((err) => logErr('contact card failed', err))
        return
    }

    const history = await loadHistory(chatGuid, MAX_HISTORY)

    // First-ever message in this chat: onboarding contact card. DB-backed
    // (was a process-memory Set on the VPS) so it works statelessly.
    if (history.length === 0) {
        await (space as InboundSpace & { send(b: unknown): Promise<unknown> })
            .send(nativeContactCard())
            .catch((err) => logErr('onboarding contact card failed', err))
    }

    // Gmail/Calendar requested while unconnected: one-use connect link.
    if (wantsGoogle(text) && !(await isGoogleConnected(chatGuid).catch(() => false))) {
        try {
            const link = await createConnectLink(chatGuid, text)
            await saveMessage(chatGuid, 'user', text)
            await sendText(
                space,
                chatGuid,
                'connect_link',
                `email + calendar aren't connected yet — connect google and i'll take it from there:\n${link}`
            )
        } catch (err) {
            logErr('connect link failed', err)
            await sendText(space, chatGuid, 'error_notice', "couldn't start the connect flow — try again in a moment.")
        }
        return
    }

    if (!SHIPYARD_API_KEY) {
        logErr('reply failed', new Error('SHIPYARD_API_KEY is not set'))
        await sendText(space, chatGuid, 'error_notice', 'Something went wrong on my end. Try again in a moment.')
        return
    }

    const full: Message[] = [...history, { role: 'user', content: text }]
    await saveMessage(chatGuid, 'user', text)

    try {
        const reply = await chat(full, {
            gatewayUrl: GATEWAY_URL,
            apiKey: SHIPYARD_API_KEY,
            model: SHIPYARD_MODEL,
        })
        await sendText(space, chatGuid, 'reply', reply)
        await saveMessage(chatGuid, 'assistant', reply)
    } catch (err) {
        logErr('gateway call failed', err)
        await sendText(space, chatGuid, 'error_notice', 'Something went wrong on my end. Try again in a moment.')
    }
}
