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
    guid: string
    send(text: string): Promise<unknown>
}

export interface InboundMessage {
    id?: string
    content: { type: string; text?: string }
    sender?: { handle?: string }
}

function logErr(context: string, err: unknown): void {
    console.error(`${context}:`, err instanceof Error ? err.message : String(err))
}

/** Enqueue-then-send: the row exists before the attempt, so a kill or a
 *  send failure is always retried by the sweep. */
async function sendText(space: InboundSpace, kind: OutboxKind, text: string): Promise<void> {
    const outboxId = await enqueueOutbox(space.guid, kind, text)
    try {
        await space.send(text)
        if (outboxId) await markOutboxSent(outboxId)
    } catch (err) {
        if (outboxId) {
            await markOutboxFailed(
                { id: outboxId, chat_guid: space.guid, kind, text, attempts: 0 },
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

    // Exactly-once: Spectrum delivery is at-least-once, dedupe on message.id.
    if (message.id) {
        const isNew = await claimInboundDelivery(message.id, space.guid)
        if (!isNew) return
    }

    await ensureIdentity(space.guid, message.sender?.handle ?? null).catch((err) =>
        logErr('identity ensure failed', err)
    )

    // On-demand contact card.
    if (isContactCardRequest(text)) {
        await (space as InboundSpace & { send(b: unknown): Promise<unknown> })
            .send(nativeContactCard())
            .catch((err) => logErr('contact card failed', err))
        return
    }

    const history = await loadHistory(space.guid, MAX_HISTORY)

    // First-ever message in this chat: onboarding contact card. DB-backed
    // (was a process-memory Set on the VPS) so it works statelessly.
    if (history.length === 0) {
        await (space as InboundSpace & { send(b: unknown): Promise<unknown> })
            .send(nativeContactCard())
            .catch((err) => logErr('onboarding contact card failed', err))
    }

    // Gmail/Calendar requested while unconnected: one-use connect link.
    if (wantsGoogle(text) && !(await isGoogleConnected(space.guid).catch(() => false))) {
        try {
            const link = await createConnectLink(space.guid, text)
            await saveMessage(space.guid, 'user', text)
            await sendText(
                space,
                'connect_link',
                `email + calendar aren't connected yet — connect google and i'll take it from there:\n${link}`
            )
        } catch (err) {
            logErr('connect link failed', err)
            await sendText(space, 'error_notice', "couldn't start the connect flow — try again in a moment.")
        }
        return
    }

    if (!SHIPYARD_API_KEY) {
        logErr('reply failed', new Error('SHIPYARD_API_KEY is not set'))
        await sendText(space, 'error_notice', 'Something went wrong on my end. Try again in a moment.')
        return
    }

    const full: Message[] = [...history, { role: 'user', content: text }]
    await saveMessage(space.guid, 'user', text)

    try {
        const reply = await chat(full, {
            gatewayUrl: GATEWAY_URL,
            apiKey: SHIPYARD_API_KEY,
            model: SHIPYARD_MODEL,
        })
        await sendText(space, 'reply', reply)
        await saveMessage(space.guid, 'assistant', reply)
    } catch (err) {
        logErr('gateway call failed', err)
        await sendText(space, 'error_notice', 'Something went wrong on my end. Try again in a moment.')
    }
}
