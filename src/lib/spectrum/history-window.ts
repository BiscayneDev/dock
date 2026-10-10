/**
 * Bound how much chat history goes on the wire. Older turns may be
 * represented in memory; trimming can omit details not captured there. A long history is much of the prompt
 * (and most of the latency). Keeps the newest messages that fit, never fewer
 * than MIN_KEEP, and always the final message (the one being answered).
 *
 * Callers must compute privacy taint (googleDerived) from the FULL history
 * before trimming; this only decides what the model sees.
 */
export const WINDOW_MESSAGES = 10
export const WINDOW_CHARS = 8000
export const MIN_KEEP = 4

export function windowHistory<T extends { content: string }>(history: T[], maxMessages = WINDOW_MESSAGES, maxChars = WINDOW_CHARS): T[] {
    if (history.length <= MIN_KEEP) return history
    const kept: T[] = []
    let chars = 0
    for (let i = history.length - 1; i >= 0; i--) {
        const len = history[i]!.content.length
        const must = kept.length < MIN_KEEP
        if (!must && (kept.length >= maxMessages || chars + len > maxChars)) break
        kept.push(history[i]!)
        chars += len
    }
    return kept.reverse()
}

/**
 * Put per-turn volatile context (clock, background, steering) in a system note
 * just before the newest message, so everything ahead of it is byte-stable
 * across tool-loop iterations. Across turns, rolling history and memory can still change. No-op when there is nothing volatile.
 */
export function withVolatileNote<T extends Record<string, unknown>>(messages: T[], note: string | undefined): (T | { role: 'system'; content: string })[] {
    const text = (note ?? '').trim()
    if (!text || messages.length === 0) return messages
    const out: (T | { role: 'system'; content: string })[] = messages.slice(0, -1)
    out.push({ role: 'system', content: text })
    out.push(messages[messages.length - 1]!)
    return out
}
