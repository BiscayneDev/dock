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
    "user's message triggered one, you will not even be called. Do not promise any other " +
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
const NO_TOOLS_EMAIL_LINE =
    'If the user asks about email or calendar and no link was sent, say they are not connected yet ' +
    'and that they can ask again to get a connect link.'

const TOOLS_EMAIL_LINE =
    "You have live read access to this user's Gmail and Google Calendar through tools. " +
    'Use them when they ask about email, meetings, or their schedule, and answer from the ' +
    'tool results in plain language — never dump raw JSON. If a tool reports the ' +
    'integration is not connected, say they can ask for a connect link.'

export function buildSystemPrompt(facts: DinghyFact[], includeOpener: boolean, toolsAvailable = false): string {
    let prompt = BASE_PROMPT
    prompt += ' ' + (toolsAvailable ? TOOLS_EMAIL_LINE : NO_TOOLS_EMAIL_LINE)
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

// ── Tool-calling loop (gateway OpenAI-compatible tools, live-verified
// 2026-09-22: tool_calls + finish_reason "tool_calls" on the pinned
// hopscotch model) ────────────────────────────────────────────────────────

import type { Tool, UserContext } from '@/lib/llm/types'

const MAX_TOOL_ITERATIONS = 4
const TOOL_TIMEOUT_MS = 15_000
/** Keep single tool results small enough for the model + the latency budget. */
const TOOL_RESULT_CHAR_CAP = 4000

interface GatewayToolCall {
    id: string
    type: string
    function: { name: string; arguments: string }
}

export interface ToolChatResult {
    reply: string
    toolCalls: number
    iterations: number
}

/**
 * chat() with read tools: the gateway decides tool_calls, we execute them
 * locally against the bound user's tokens and loop until a text answer.
 * The typing indicator (fired by the caller) covers the extra round trips.
 */
export async function chatWithTools(
    history: Message[],
    opts: { gatewayUrl: string; apiKey: string; model: string; facts?: DinghyFact[]; includeOpener?: boolean },
    tools: Tool[],
    ctx: UserContext
): Promise<ToolChatResult> {
    const toolDefs = tools.map((t) => ({
        type: 'function' as const,
        function: { name: t.name, description: t.description, parameters: t.inputSchema },
    }))
    const messages: Record<string, unknown>[] = [
        { role: 'system', content: buildSystemPrompt(opts.facts ?? [], opts.includeOpener ?? false, true) },
        ...history,
    ]

    let toolCallCount = 0
    for (let iteration = 1; iteration <= MAX_TOOL_ITERATIONS; iteration++) {
        const res = await fetch(`${opts.gatewayUrl}/v1/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${opts.apiKey}`,
            },
            body: JSON.stringify({ model: opts.model, messages, tools: toolDefs, stream: false }),
        })
        if (!res.ok) {
            const body = await res.text().catch(() => '')
            throw new Error(`Gateway ${res.status}: ${body || res.statusText}`)
        }
        const data = (await res.json()) as {
            choices: { finish_reason: string; message: { content: string | null; tool_calls?: GatewayToolCall[] } }[]
        }
        const choice = data.choices?.[0]
        const msg = choice?.message
        const calls = msg?.tool_calls ?? []

        if (choice?.finish_reason !== 'tool_calls' || calls.length === 0) {
            return { reply: msg?.content ?? '(no response)', toolCalls: toolCallCount, iterations: iteration }
        }

        messages.push({ role: 'assistant', content: msg?.content ?? null, tool_calls: calls })
        for (const call of calls) {
            toolCallCount++
            const tool = tools.find((t) => t.name === call.function.name)
            let content: string
            if (!tool) {
                content = JSON.stringify({ error: `unknown tool ${call.function.name}` })
            } else {
                try {
                    const input = JSON.parse(call.function.arguments || '{}') as unknown
                    const result = await Promise.race([
                        tool.execute(input, ctx),
                        new Promise<never>((_, reject) =>
                            setTimeout(() => reject(new Error(`tool timed out after ${TOOL_TIMEOUT_MS / 1000}s`)), TOOL_TIMEOUT_MS)
                        ),
                    ])
                    content = JSON.stringify(result.success ? result.data ?? {} : { error: result.error ?? 'tool failed' })
                } catch (err) {
                    content = JSON.stringify({ error: err instanceof Error ? err.message : String(err) })
                }
            }
            if (content.length > TOOL_RESULT_CHAR_CAP) content = content.slice(0, TOOL_RESULT_CHAR_CAP) + '…'
            messages.push({ role: 'tool', tool_call_id: call.id, content })
        }
    }
    // Loop exhausted: ask for a plain-text answer without tools.
    const res = await fetch(`${opts.gatewayUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${opts.apiKey}` },
        body: JSON.stringify({ model: opts.model, messages, stream: false }),
    })
    if (!res.ok) throw new Error(`Gateway ${res.status}: ${res.statusText}`)
    const data = (await res.json()) as { choices: { message: { content: string | null } }[] }
    return {
        reply: data.choices?.[0]?.message?.content ?? '(no response)',
        toolCalls: toolCallCount,
        iterations: MAX_TOOL_ITERATIONS + 1,
    }
}
