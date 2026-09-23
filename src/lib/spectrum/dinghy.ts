/**
 * Dinghy conversation logic, ported from src/spectrum/index.ts for the
 * serverless webhook route. Pure of transport: callers supply persistence
 * and send functions.
 */

export interface Message {
    role: 'user' | 'assistant' | 'system'
    content: string
}

export const MAX_HISTORY = 20

export const SYSTEM_PROMPT =
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
    "You're direct, concise, and helpful. You don't waste words on pleasantries. " +
    'In a fresh chat, open with the question: "what\'s eating your time this week?" ' +
    'and work from their answer.'

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
    opts: { gatewayUrl: string; apiKey: string; model: string }
): Promise<string> {
    const messages = [{ role: 'system' as const, content: SYSTEM_PROMPT }, ...history]

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
