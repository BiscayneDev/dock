/**
 * Outbound rich links: a URL as its own bubble with the native link-preview
 * card (Spectrum richlink → remote iMessage `enableLinkPreview`), instead of
 * a bare URL that may or may not unfurl.
 */

import { richlink } from 'spectrum-ts'
import { enqueueOutbox, markOutboxFailed, markOutboxSent, type OutboxKind } from './outbox'

export interface LinkSender {
    send(content: unknown): Promise<unknown>
}

function logErr(context: string, err: unknown): void {
    console.error(`${context}:`, err instanceof Error ? err.message : String(err))
}

/**
 * Send a URL with its native preview card. The outbox row stores the bare
 * URL so the sweep's text retry still delivers the link; if the rich send
 * itself fails, the bare URL goes out immediately as a fallback.
 */
export async function sendLink(space: LinkSender, chatGuid: string, kind: OutboxKind, url: string): Promise<void> {
    const outboxId = await enqueueOutbox(chatGuid, kind, url)
    try {
        await space.send(richlink(url))
        if (outboxId) await markOutboxSent(outboxId)
        return
    } catch (err) {
        logErr('rich link send failed', err)
    }
    try {
        await space.send(url)
        if (outboxId) await markOutboxSent(outboxId)
    } catch (err) {
        if (outboxId) {
            await markOutboxFailed({ id: outboxId, chat_guid: chatGuid, kind, text: url, attempts: 0 }, err)
        } else {
            logErr('link send failed and outbox enqueue failed (untracked)', err)
        }
    }
}

/**
 * Split a bare URL standing on its own line out of a reply, so it can go out
 * as a rich-link bubble that unfurls. Only the last standalone URL is split;
 * inline links stay in the text.
 */
export function splitStandaloneUrl(text: string): { text: string; url: string | null } {
    const lines = text.split('\n')
    for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i]!.trim()
        if (/^https?:\/\/\S+$/.test(line)) {
            const rest = [...lines.slice(0, i), ...lines.slice(i + 1)].join('\n').trim()
            return { text: rest, url: line }
        }
        if (line !== '') return { text, url: null }
    }
    return { text, url: null }
}
