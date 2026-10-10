/**
 * What kind of work a gateway call is, and how long it can reasonably take.
 * Sent as plain request headers so the router has a prior instead of guessing
 * from the last message alone. Headers are ignored by a gateway that does not
 * read them, so this is safe to ship ahead of router support. It never names
 * or pins a model and never touches the provider allowlist.
 */
export type TaskClass = 'chat' | 'lookup' | 'research' | 'synthesize' | 'background'

export const LATENCY_BUDGET_MS: Record<TaskClass, number | null> = {
    chat: 4_000,
    lookup: 12_000,
    research: 40_000,
    synthesize: 12_000,
    background: null,
}

const RESEARCH = /\b(research|compare|comparison|versus|vs\.?|best|pros and cons|deep dive|analy[sz]e|analysis|report|investigate|in[- ]depth|summari[sz]e (the|this|these)|news|latest on)\b/i
const LOOKUP = /\b(near(by| me)?|where|open( now)?|hours|address|phone|directions?|weather|forecast|price of|how much|what time|when does|restaurants?|food|eat|coffee|find|search|look up|who is|what is)\b/i

/** Deterministic first guess for a user turn. The router can still disagree. */
export function classifyUserTurn(text: string): TaskClass {
    const t = text.trim()
    if (RESEARCH.test(t) || t.length > 400) return 'research'
    if (LOOKUP.test(t) || /\?\s*$/.test(t)) return 'lookup'
    return 'chat'
}

/** After tool results are in, the model is mostly writing the answer: that is synthesis unless the turn is research. */
export function classForIteration(base: TaskClass, iteration: number): TaskClass {
    if (base === 'background' || base === 'research') return base
    return iteration > 1 ? 'synthesize' : base
}

export function hintHeaders(cls: TaskClass | undefined, needsTools: boolean): Record<string, string> {
    if (!cls) return {}
    const budget = LATENCY_BUDGET_MS[cls]
    return {
        'x-dinghy-task-class': cls,
        'x-dinghy-needs-tools': needsTools ? '1' : '0',
        ...(budget === null ? {} : { 'x-dinghy-latency-budget-ms': String(budget) }),
    }
}
