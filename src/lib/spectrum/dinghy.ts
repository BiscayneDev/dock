/**
 * Dinghy conversation logic, ported from src/spectrum/index.ts for the
 * serverless webhook route. Pure of transport: callers supply persistence
 * and send functions.
 */

export interface Message {
    role: 'user' | 'assistant' | 'system'
    content: string
}

export interface DinghyFact {
    key: string
    value: string
}

export const MAX_HISTORY = 20

const BASE_PROMPT =
    'You are Dinghy, a personal AI first mate accessible via iMessage. ' +
    'Right now you can hold a text conversation, share your contact card when asked, ' +
    'and remember context within the current conversation. There is also a waitlist ' +
    'site at getdinghy.sh where people can sign up for the beta. ' +
    'Gmail and Google Calendar connect through a one-tap link you can send in the ' +
    'chat — but the connect-link message itself (not you) handles that: when the ' +
    "user's message triggered one, you will not even be called. If the user asks " +
    'about email or calendar and no link was sent, say they are not connected yet ' +
    'and that they can ask again to get a connect link. Do not promise any other ' +
    'integration — GitHub, Notion, and others are not connected. ' +
    "You're direct, concise, and helpful. You don't waste words on pleasantries."

const OPENER_INSTRUCTION =
    'In a fresh chat, open with the question: "what\'s eating your time this week?" ' +
    'and work from their answer.'

/**
 * System prompt assembly. Durable facts ride along on every message so a
 * thin-history chat never reads as a total stranger. The opener question
 * fires ONLY for a genuinely new user (zero facts AND zero history) — it
 * used to be unconditional, so every history-load blip re-asked it.
 */
export function buildSystemPrompt(facts: DinghyFact[], includeOpener: boolean): string {
    let prompt = BASE_PROMPT
    if (facts.length > 0) {
        prompt += ' Known facts:\n' + facts.map((f) => `- ${f.key}: ${f.value}`).join('\n')
    }
    if (includeOpener) prompt += ' ' + OPENER_INSTRUCTION
    return prompt
}

export const GOOGLE_INTENT =
    /\b(gmail|e-?mails?|inbox|calendar|calender|schedule(d)?|meetings?|appointments?|events? this week|my day)\b/i

const CONTACT_CARD_TRIGGERS = [
    'contact card', 'my card', 'share card', 'your card', 'add me',
    'save contact', 'contact details', 'save your contact', 'save your details', 'your contact',
]

export function isContactCardRequest(text: string): boolean {
    const lower = text.toLowerCase()
    return CONTACT_CARD_TRIGGERS.some((t) => lower.includes(t))
}

export function wantsGoogle(text: string): boolean {
    return GOOGLE_INTENT.test(text)
}

/** Shipyard gateway call (OpenAI-compatible). Plain HTTP, works anywhere. */
export async function chat(
    history: Message[],
    opts: { gatewayUrl: string; apiKey: string; model: string; facts?: DinghyFact[]; includeOpener?: boolean }
): Promise<string> {
    const messages = [
        { role: 'system' as const, content: buildSystemPrompt(opts.facts ?? [], opts.includeOpener ?? false) },
        ...history,
    ]

    const res = await fetch(`${opts.gatewayUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${opts.apiKey}`,
        },
        body: JSON.stringify({ model: opts.model, messages, stream: false }),
    })

    if (!res.ok) {
        const body = await res.text().catch(() => '')
        throw new Error(`Gateway ${res.status}: ${body || res.statusText}`)
    }

    const data = (await res.json()) as {
        choices: { message: { content: string | null } }[]
    }

    return data.choices?.[0]?.message?.content ?? '(no response)'
}
