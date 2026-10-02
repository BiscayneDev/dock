/**
 * Demo chats: a synthetic Dinghy identity with no phone behind it, driven from
 * an admin web page. The chat guid is `demo;-;<slug>`, which no real iMessage
 * handle can produce, so nothing here can text a real number or touch a real
 * user. Same handler, tools and Google connect flow as iMessage; only the
 * transport differs: sends are captured and saved to history instead of going
 * out through Photon.
 */
import { saveMessage } from '@/spectrum/store'

export const DEMO_PREFIX = 'demo;-;'

export function isDemoGuid(guid: string): boolean {
    return guid.startsWith(DEMO_PREFIX)
}

export function demoGuid(slug: string): string | null {
    const s = slug.trim().toLowerCase()
    return /^[a-z0-9][a-z0-9_-]{1,39}$/.test(s) ? `${DEMO_PREFIX}${s}` : null
}

type Sendable = { type?: string; url?: string; text?: string; content?: unknown }

function textOf(content: unknown): string | null {
    if (typeof content === 'string') return content
    const c = content as Sendable | null
    if (c && typeof c.url === 'string') return c.url
    if (c && typeof c.text === 'string') return c.text
    return null // typing indicators, reactions, attachments
}

/** A space for a demo chat. Captures sends; with persist, also saves them as assistant history. */
export function demoSpace(guid: string, opts: { persist: boolean }): { id: string; send(content: unknown): Promise<unknown>; sent: string[] } {
    const sent: string[] = []
    return {
        id: guid,
        sent,
        async send(content: unknown) {
            const t = textOf(content)
            if (!t) return undefined
            sent.push(t)
            if (opts.persist) await saveMessage(guid, 'assistant', t).catch(() => undefined)
            return undefined
        },
    }
}
