/**
 * Tapbacks and threaded replies on iMessage (spectrum-ts message.react /
 * message.reply). Pure helpers here; handler.ts wires them in.
 *
 * - Inbound: a tapback arrives as content.type "reaction" ({emoji, target});
 *   a threaded reply as content.type "reply" ({content, target}). The SDK
 *   rebuilds the target from Apple's message, so target.content carries its text.
 * - Outbound: react() takes native tapback emoji or any emoji (iOS 18 emoji
 *   tapbacks); reply() sends a native threaded reply.
 */

export interface MessageLike {
    id?: string
    direction?: string
    content: {
        type: string
        text?: string
        emoji?: string
        content?: { type?: string; text?: string }
        target?: { id?: string; direction?: string; content?: { type?: string; text?: string } }
    }
    react?: (emoji: string) => Promise<unknown>
    reply?: (content: unknown) => Promise<unknown>
}

export type Inbound =
    | { kind: 'text'; text: string; replyTo?: { text: string; fromAgent: boolean } }
    | { kind: 'reaction'; emoji: string; targetText: string }

/** Text, a threaded reply (unwrapped), or a tapback. Anything else: null. */
export function normalizeInbound(message: MessageLike): Inbound | null {
    const c = message.content
    if (c.type === 'text' && typeof c.text === 'string') return { kind: 'text', text: c.text }
    if (c.type === 'reply' && c.content?.type === 'text' && typeof c.content.text === 'string') {
        const targetText = targetTextOf(c.target)
        return {
            kind: 'text',
            text: c.content.text,
            ...(targetText ? { replyTo: { text: targetText, fromAgent: c.target?.direction === 'outbound' } } : {}),
        }
    }
    if (c.type === 'reaction' && typeof c.emoji === 'string') {
        return { kind: 'reaction', emoji: c.emoji, targetText: targetTextOf(c.target) }
    }
    return null
}

function targetTextOf(target: MessageLike['content']['target']): string {
    const t = target?.content
    return t?.type === 'text' && typeof t.text === 'string' ? t.text : ''
}

/** Only Dinghy's rendered draft previews end like this (actions.renderProposal). */
const PROPOSAL_TAIL = /reply y to \w+, n to cancel\s*$/i

/** A tapback on the open draft's preview: 👍/❤️ = yes, 👎 = no. */
export function reactionDecision(emoji: string, targetText: string): 'yes' | 'no' | null {
    if (!PROPOSAL_TAIL.test(targetText)) return null
    if (emoji === '👍' || emoji === '❤️') return 'yes'
    if (emoji === '👎') return 'no'
    return null
}

const THANKS = /^\s*(thanks|thank you|thx|ty|tysm|thanks so much|thank you so much|appreciate it|much appreciated|legend|you'?re the best|❤️|🙏)\s*[.!]*\s*$/i
const ACK = /^\s*(ok|okay|k|kk|got it|cool|nice|great|perfect|awesome|sounds good|all good|noted|will do|love it|👍|👌|🙌)\s*[.!]*\s*$/i

/**
 * A message that needs no words back: "thanks" gets ❤️, "ok"/"got it" 👍.
 * Never when Dinghy's last message asked something - then "ok" is an answer.
 */
export function ackTapback(text: string, lastAssistant: string | null): '❤️' | '👍' | null {
    if (lastAssistant && /\?\s*$/.test(lastAssistant.trim())) return null
    if (THANKS.test(text)) return '❤️'
    if (ACK.test(text)) return '👍'
    return null
}

/** Best-effort tapback. Returns the reaction handle (for unsend) or null. */
export async function tapback(message: MessageLike, emoji: string): Promise<{ unsend?: () => Promise<unknown> } | null> {
    try {
        if (typeof message.react !== 'function') return null
        const r = await message.react.call(message, emoji)
        return (r as { unsend?: () => Promise<unknown> } | undefined) ?? null
    } catch (err) {
        console.error('tapback failed:', err instanceof Error ? err.message : String(err))
        return null
    }
}

/** The model's view of a threaded reply: their words plus what they replied to. */
export function withReplyContext(text: string, replyTo?: { text: string; fromAgent: boolean }): string {
    if (!replyTo) return text
    const snippet = replyTo.text.length > 280 ? `${replyTo.text.slice(0, 280)}…` : replyTo.text
    return `${text}\n\n(they sent this as a reply to ${replyTo.fromAgent ? 'your earlier message' : 'their own earlier message'}: "${snippet}")`
}

/**
 * Thread the answer when it would otherwise land out of place: they replied
 * in-thread, or they sent something else after this message while we worked.
 */
export function shouldThread(
    inbound: { replyTo?: unknown },
    recent: { role: string; content: string }[],
    text: string
): boolean {
    if (inbound.replyTo) return true
    let mine = -1
    for (let i = recent.length - 1; i >= 0; i--) {
        if (recent[i].role === 'user' && recent[i].content === text) {
            mine = i
            break
        }
    }
    if (mine < 0) return false
    return recent.slice(mine + 1).some((m) => m.role === 'user')
}
