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

/** Dinghy's own site. Search engines barely know it yet, and "dinghy" search hits are other companies. */
export const SITE_LINE =
    "Your own website is getdinghy.sh: the landing page for you, with the beta waitlist, 'join the beta', and a sign-in " +
    'where people open their Dinghy profile to see and connect their accounts. If someone asks about your website, ' +
    "that is it - answer from this, don't web_search for it. Web results for \"dinghy\" are other companies " +
    '(e.g. a UK boat insurer), not you.'

/**
 * Halsey's direction (Sep 23): Dinghy is confident it's helping people use AI
 * safely, securely and openly. Own the capabilities; the guardrails are the
 * product, not an apology.
 */
export const VOICE_LINE =
    "You're confident about what you do: you help people use AI in their real life safely, securely and openly. " +
    'Own your abilities plainly and with some pride. When someone compliments you or asks what you can do, lead with ' +
    'what you actually do for them, with a quick concrete example from their own connected accounts, and never answer ' +
    'with a list of things you cannot do. Your safeguards are a feature you stand behind, so say them as protection, ' +
    'not as limits: "nothing sends or moves money without your yes", "your keys and passwords never touch the chat". ' +
    'Only mention something you do not do when the user asks for it, then say it in one short line and offer what you can do. ' +
    "No self-deprecation, no \"I'm pretty limited\", no hedging about being just an AI. "

const BASE_PROMPT =
    'You are Dinghy, a personal AI first mate that lives in iMessage. ' +
    'You hold a real conversation, remember what people tell you across conversations, ' +
    'and share your contact card when asked. ' +
    'Gmail and Google Calendar connect through a one-tap link: the connect-link message itself (not you) ' +
    "handles that, and when the user's message triggered one you will not even be called. " +
    'Only claim abilities this prompt gives you; other integrations (GitHub and the rest) are not connected. ' +
    "You're direct, concise, and helpful. You don't waste words on pleasantries. " +
    VOICE_LINE +
    'Write like a text: short, lowercase is fine, no markdown headings. ' +
    SITE_LINE

const OPENER_INSTRUCTION =
    'This is their very first message to you. If it asks for something, help with it first. ' +
    'Then, in two short lines at most: say hi as Dinghy, mention your contact card just arrived so they can save you, ' +
    'and ask: "what\'s eating your time this week?" Work from their answer.'

/**
 * System prompt assembly. Durable facts ride along on every message so a
 * thin-history chat never reads as a total stranger. The opener question
 * fires ONLY for a genuinely new user (zero facts AND zero history) — it
 * used to be unconditional, so every history-load blip re-asked it.
 */
const WALLET_LINE =
    "You have live READ-ONLY access to this user's crypto wallets through PayBox (wallet_balances). " +
    'Answer balance and holdings questions from it in plain language with USD values. Money only ' +
    'ever moves with their PayBox passkey approval; that is the point, so say it with confidence. ' +
    'If they ask to send or sign, say plainly that passkey-approved sends are landing soon. Never invent balances. When balances look low for what they ' +
    'want to do — x402 paid APIs, inference spend, a pending swap — offer paybox_onramp: a hosted ' +
    'buy link (card → USDC straight into their wallet, completed in PayBox with their passkey). ' +
    'One short offer, never pushy.'
const NO_WALLET_LINE =
    'Crypto wallet access connects through PayBox via a one-tap link that is sent automatically when ' +
    'the user asks about their wallet or balances. You cannot see any wallet right now; never guess balances.'

export interface PromptCapabilities {
    google: boolean
    wallet: boolean
    /** create_file is offered (any chat bound to a user). */
    files?: boolean
    /** weather tool is offered (every chat). */
    live?: boolean
    /** web_search is offered (TAVILY_API_KEY set). */
    search?: boolean
    /** spend_summary is offered. */
    spend?: boolean
    /** reminder_set / list / cancel are offered. */
    reminders?: boolean
    /** X (Twitter) read tools are offered. */
    x?: boolean
    xFree?: boolean
    xSearch?: boolean
    github?: boolean
    health?: boolean
}

const FILES_LINE =
    'You can make real documents with create_file (PDF by default; Word, CSV, web page or Markdown on request) ' +
    'for plans, itineraries, notes, checklists and tables; they arrive in this chat as a file right after your reply. ' +
    'Offer one when a list or plan would be easier to keep as a document, and make it when asked.'

const WEATHER_LINE =
    'For weather, temperature or forecast questions, call the weather tool and answer from it; never guess the weather.'

const SEARCH_LINE =
    'For news, scores, prices, hours, recent events or anything that may have changed, call web_search ' +
    'and answer from the results in a line or two; mention the source when it matters.'

const NO_SEARCH_LINE =
    "Live web search isn't switched on here, so for news, scores, prices or recent events say in one line you can't check that live right now, and help with what you can."

const REMINDERS_LINE =
    'When asked to remind them of something, call reminder_set (it texts this chat at that time) and confirm the day and time in plain words. ' +
    'Use reminder_list and reminder_cancel to show or cancel pending reminders. Never say a reminder is set unless the tool succeeded.'

/** Morning-briefing behavior note (C2): default-on, muted by exact reply. */
const BRIEFING_LINE =
    'Every morning around 8 the user gets a short briefing text (today\'s calendar + unread email); ' +
    'the last line invites them to reply "mute mornings" to stop it or "unmute mornings" to restart. ' +
    'You do not send the briefing yourself — if they ask about it, explain that and mention the mute/unmute replies.'

const X_LINE =
    'For what people are saying on X (Twitter), their timeline, or a specific account\'s posts, call twitter_search, twitter_timeline or twitter_user_tweets ' +
    'and sum it up in a line or two, naming the accounts. You can only read X; never say you posted, liked or replied.'

const X_FREE_LINE =
    'For X (Twitter): x_read_post reads a post from its link, x_profile looks up an account, x_recent_posts shows what an account posted lately. ' +
    'Sum up in a line or two and name the accounts. You can only read X; never say you posted, liked, followed or replied.'

const X_SEARCH_LINE =
    'To find what people are saying on X about a topic, call x_search and summarize the main takes.'

const NO_X_SEARCH_LINE =
    "You can't keyword-search X yet; you can read a post from its link or a specific account's recent posts."

const GITHUB_LINE =
    'For GitHub (their repos, issues, pull requests, notifications), use the github_ tools and answer in plain words with the repo and number. ' +
    'You can only read GitHub from here; never say you opened, commented on, merged or closed anything.'

const HEALTH_LINE =
    'For sleep, recovery, readiness, strain, activity or heart rate, call the health_ tools (their Oura or WHOOP) and give the numbers plainly with one line of takeaway. ' +
    'No medical advice; suggest a doctor for anything that sounds serious.'

const SPEND_LINE =
    'For questions about AI spend, cost or usage, call spend_summary and give the number plainly.'

const NO_TOOLS_EMAIL_LINE =
    'If the user asks about email or calendar and no link was sent, say they are not connected yet ' +
    'and that they can ask again to get a connect link.'

const TOOLS_EMAIL_LINE =
    "You have live access to this user's Gmail and Google Calendar through tools. " +
    'You can draft emails and replies (email_send, email_reply) and invites (gcal_create_event with attendees); ' +
    'those only become drafts the user confirms with y, so never say anything was sent. ' +
    'Events on their own calendar with no attendees are created immediately. ' +
    'Use them when they ask about email, meetings, or their schedule, and answer from the ' +
    'tool results in plain language — never dump raw JSON. If a tool reports the ' +
    'integration is not connected, say they can ask for a connect link.'

export function buildSystemPrompt(
    facts: DinghyFact[],
    includeOpener: boolean,
    toolsAvailable: boolean | PromptCapabilities = false
): string {
    const caps: PromptCapabilities =
        typeof toolsAvailable === 'boolean' ? { google: toolsAvailable, wallet: false } : toolsAvailable
    let prompt = BASE_PROMPT
    prompt += ' ' + (caps.google ? TOOLS_EMAIL_LINE : NO_TOOLS_EMAIL_LINE)
    if (caps.google) prompt += ' ' + BRIEFING_LINE
    prompt += ' ' + (caps.wallet ? WALLET_LINE : NO_WALLET_LINE)
    if (caps.files) prompt += ' ' + FILES_LINE
    if (caps.spend) prompt += ' ' + SPEND_LINE
    if (caps.reminders) prompt += ' ' + REMINDERS_LINE
    if (caps.github) prompt += ' ' + GITHUB_LINE
    if (caps.health) prompt += ' ' + HEALTH_LINE
    if (caps.xFree) prompt += ' ' + X_FREE_LINE
    if (caps.x) prompt += ' ' + X_LINE
    else if (caps.xFree) prompt += ' ' + (caps.xSearch ? X_SEARCH_LINE : NO_X_SEARCH_LINE)
    if (caps.live) prompt += ' ' + WEATHER_LINE + ' ' + (caps.search ? SEARCH_LINE : NO_SEARCH_LINE)
    if (facts.length > 0) {
        prompt += ' About Dinghy (product context, not facts about the person you are texting):\n' + facts.map((f) => `- ${f.key}: ${f.value}`).join('\n')
    }
    if (includeOpener) prompt += ' ' + OPENER_INSTRUCTION
    return prompt
}
/**
 * dinghy_facts are product context shared by every chat. Beta members get
 * only the product facts, never owner-specific ones.
 */
export function productFactsFor(role: string | null, facts: DinghyFact[]): DinghyFact[] {
    if (role === 'owner') return facts
    return facts.filter((f) => f.key !== 'owner')
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

export const WALLET_INTENT =
    /\b(wallets?|(?:my |wallet |crypto |token )balances?|portfolio|crypto|usdc|usdt|eth|ether|ethereum|sol|solana|base chain|tokens? (do i|i) (have|hold)|paybox|on-?chain)\b/i

export const GITHUB_INTENT = /\b(github|git hub|my repos?|repositor(?:y|ies)|pull requests?|my prs?)\b/i

export function wantsGithub(text: string): boolean {
    return GITHUB_INTENT.test(text)
}

export const HEALTH_INTENT = /\b(oura|whoop|my sleep|slept|how did i sleep|sleep last night|sleep score|recovery|readiness|hrv|resting heart rate|heart rate|strain)\b/i

export function wantsHealth(text: string): boolean {
    return HEALTH_INTENT.test(text)
}

export function wantsWallet(text: string): boolean {
    return WALLET_INTENT.test(text)
}

/** Shipyard gateway call (OpenAI-compatible). Plain HTTP, works anywhere. */
export async function chat(
    history: Message[],
    opts: {
        gatewayUrl: string
        apiKey: string
        model: string
        facts?: DinghyFact[]
        includeOpener?: boolean
        memory?: string
        capabilities?: PromptCapabilities
        /** Day-1 interview: one short question this reply should end with (interview.ts). */
        interviewLine?: string
        /** Called once per gateway call with its token usage (metering.ts). */
        onUsage?: (u: GatewayUsage) => void
    }
): Promise<string> {
    const messages = [
        {
            role: 'system' as const,
            content: buildSystemPrompt(opts.facts ?? [], opts.includeOpener ?? false, opts.capabilities ?? false) + (opts.memory ?? '') + (opts.interviewLine ? ' ' + opts.interviewLine : ''),
        },
        ...history,
    ]

    const t0 = Date.now()
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
        model?: string
        usage?: { prompt_tokens?: number; completion_tokens?: number }
        choices: { message: { content: string | null } }[]
    }
    reportUsage(opts.onUsage, res, data, opts.model, Date.now() - t0)

    return data.choices?.[0]?.message?.content ?? '(no response)'
}

// ── Tool-calling loop (gateway OpenAI-compatible tools, live-verified
// 2026-09-22: tool_calls + finish_reason "tool_calls" on the pinned
// hopscotch model) ────────────────────────────────────────────────────────

import type { Tool, UserContext } from '@/lib/llm/types'
import { readGatewayUsage, type GatewayUsage } from './metering'

function reportUsage(
    onUsage: ((u: GatewayUsage) => void) | undefined,
    res: Response,
    data: { model?: string; usage?: { prompt_tokens?: number; completion_tokens?: number } },
    model: string,
    latencyMs: number
): void {
    if (!onUsage) return
    try {
        onUsage(readGatewayUsage(res, data, model, latencyMs))
    } catch {
        // metering never breaks a reply
    }
}

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
    opts: {
        gatewayUrl: string
        apiKey: string
        model: string
        facts?: DinghyFact[]
        includeOpener?: boolean
        capabilities?: PromptCapabilities
        /** Rendered memory block (memory.ts renderMemoryBlock), appended to the system prompt. */
        memory?: string
        /** Day-1 interview: one short question this reply should end with (interview.ts). */
        interviewLine?: string
        /** Called once per gateway call with its token usage (metering.ts). */
        onUsage?: (u: GatewayUsage) => void
    },
    tools: Tool[],
    ctx: UserContext
): Promise<ToolChatResult> {
    const toolDefs = tools.map((t) => ({
        type: 'function' as const,
        function: { name: t.name, description: t.description, parameters: t.inputSchema },
    }))
    const messages: Record<string, unknown>[] = [
        {
            role: 'system',
            content: buildSystemPrompt(
                opts.facts ?? [],
                opts.includeOpener ?? false,
                opts.capabilities ?? { google: Boolean(ctx.tokens.google), wallet: Boolean(ctx.tokens.paybox) }
            ) + (opts.memory ?? '') + (opts.interviewLine ? ' ' + opts.interviewLine : ''),
        },
        ...history,
    ]

    let toolCallCount = 0
    for (let iteration = 1; iteration <= MAX_TOOL_ITERATIONS; iteration++) {
        const t0 = Date.now()
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
            model?: string
            usage?: { prompt_tokens?: number; completion_tokens?: number }
            choices: { finish_reason: string; message: { content: string | null; tool_calls?: GatewayToolCall[] } }[]
        }
        reportUsage(opts.onUsage, res, data, opts.model, Date.now() - t0)
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
    const tFinal = Date.now()
    const res = await fetch(`${opts.gatewayUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${opts.apiKey}` },
        body: JSON.stringify({ model: opts.model, messages, stream: false }),
    })
    if (!res.ok) throw new Error(`Gateway ${res.status}: ${res.statusText}`)
    const data = (await res.json()) as {
        model?: string
        usage?: { prompt_tokens?: number; completion_tokens?: number }
        choices: { message: { content: string | null } }[]
    }
    reportUsage(opts.onUsage, res, data, opts.model, Date.now() - tFinal)
    return {
        reply: data.choices?.[0]?.message?.content ?? '(no response)',
        toolCalls: toolCallCount,
        iterations: MAX_TOOL_ITERATIONS + 1,
    }
}
