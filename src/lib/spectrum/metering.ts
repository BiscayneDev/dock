/**
 * Dinghy metering: record every gateway call on the iMessage path to
 * inference_usage (via dinghy_record_usage, migration 028) and answer
 * "how much have we spent" from it.
 *
 * Never moves money: rows are written with charged_usd NULL, so billing
 * settlement (src/lib/billing/settle.ts) never picks them up.
 */

import { createServerClient } from '@/lib/supabase/server'
import type { Tool, ToolResult } from '@/lib/llm/types'

export interface GatewayUsage {
    model: string
    inputTokens: number
    outputTokens: number
    /** From the gateway's x-shipyard-cost-usd header when exposed. */
    costUsd: number | null
    latencyMs: number
}

/**
 * List prices (USD per 1M tokens) used only when the gateway does not report
 * a cost. Source: platform.claude.com/docs/en/models/haiku-4-5/overview
 * (Haiku 4.5: $1 input / $5 output), checked 2026-09-23.
 */
const LIST_PRICES: { match: RegExp; input: number; output: number }[] = [
    { match: /haiku-4-5/i, input: 1, output: 5 },
    { match: /sonnet-4-5/i, input: 3, output: 15 },
    // Hopscotch catalog (routed via Shipyard auto; the gateway's cost header wins when present).
    { match: /sonnet-5/i, input: 2, output: 10 },
    { match: /gpt-5/i, input: 1.25, output: 10 },
    { match: /gpt-4o-mini/i, input: 0.15, output: 0.6 },
]

export function estimateCostUsd(model: string, inputTokens: number, outputTokens: number): number | null {
    const p = LIST_PRICES.find((x) => x.match.test(model))
    if (!p) return null
    return (inputTokens * p.input + outputTokens * p.output) / 1_000_000
}

/** Pull usage + cost out of a gateway response. Never throws. */
export function readGatewayUsage(
    res: { headers: { get(name: string): string | null } },
    data: { model?: string; usage?: { prompt_tokens?: number; completion_tokens?: number } },
    requestedModel: string,
    latencyMs: number
): GatewayUsage {
    const headerCost = Number.parseFloat(res.headers.get('x-shipyard-cost-usd') ?? '')
    return {
        model: res.headers.get('x-shipyard-model') || data.model || requestedModel,
        inputTokens: data.usage?.prompt_tokens ?? 0,
        outputTokens: data.usage?.completion_tokens ?? 0,
        costUsd: Number.isFinite(headerCost) ? headerCost : null,
        latencyMs,
    }
}

/** Write one row per gateway call. Errors are swallowed: metering must never break a reply. */
export async function recordUsage(chatGuid: string, source: string, calls: GatewayUsage[]): Promise<void> {
    if (calls.length === 0) return
    const supabase = createServerClient()
    for (const c of calls) {
        const estimated = c.costUsd == null
        const cost = estimated ? estimateCostUsd(c.model, c.inputTokens, c.outputTokens) : c.costUsd
        const { error } = await supabase.rpc('dinghy_record_usage', {
            p_chat_guid: chatGuid,
            p_source: source,
            p_model: c.model,
            p_input_tokens: c.inputTokens,
            p_output_tokens: c.outputTokens,
            p_cost_usd: cost,
            p_cost_estimated: estimated,
            p_latency_ms: Math.round(c.latencyMs),
        })
        if (error) throw new Error(`dinghy_record_usage: ${error.message}`)
    }
}

const PERIODS = ['today', 'week', 'month', 'all'] as const
type Period = (typeof PERIODS)[number]

export function periodStart(period: Period, now = new Date(), timeZone = 'America/New_York'): Date {
    if (period === 'all') return new Date(0)
    const days = period === 'today' ? 0 : period === 'week' ? 6 : 29
    // Midnight in the owner's timezone, `days` days back.
    const local = new Date(now.toLocaleString('en-US', { timeZone }))
    const offsetMs = now.getTime() - local.getTime()
    local.setHours(0, 0, 0, 0)
    local.setDate(local.getDate() - days)
    return new Date(local.getTime() + offsetMs)
}

function usd(n: number): string {
    return `$${n.toFixed(n > 0 && n < 0.01 ? 4 : 2)}`
}

/**
 * spend_summary for one chat. Members only ever see their own chat; the
 * owner sees totals plus a per-member breakdown. Scope is fixed here, not
 * chosen by the model.
 */
export function spendToolFor(chatGuid: string, isOwner: boolean): Tool {
    return {
        name: 'spend_summary',
        description: isOwner
            ? 'AI spend for Dinghy across every chat: total cost, calls and tokens, plus a per-member breakdown. ' +
              'Use for "how much have we spent", cost per user, or usage questions.'
            : "This chat's own AI usage with Dinghy: cost, calls and tokens. Use when they ask what they've used or spent.",
        inputSchema: {
            type: 'object',
            properties: { period: { type: 'string', enum: [...PERIODS], description: 'Default week (last 7 days)' } },
        },
        async execute(input: unknown): Promise<ToolResult> {
            const raw = (input ?? {}) as { period?: unknown }
            const period: Period = PERIODS.includes(raw.period as Period) ? (raw.period as Period) : 'week'
            try {
                const supabase = createServerClient()
                const { data, error } = await supabase.rpc('dinghy_spend_summary', {
                    p_chat_guid: chatGuid,
                    p_since: periodStart(period).toISOString(),
                    p_all: isOwner,
                })
                if (error) return { success: false, error: error.message }
                const s = data as {
                    calls: number; input_tokens: number; output_tokens: number; cost_usd: number; estimated_calls: number
                    chats: { chat_guid: string; handle: string | null; calls: number; tokens: number; cost_usd: number }[] | null
                }
                return {
                    success: true,
                    data: {
                        period,
                        scope: isOwner ? 'all chats' : 'this chat only',
                        cost: usd(Number(s.cost_usd)),
                        calls: s.calls,
                        tokens: Number(s.input_tokens) + Number(s.output_tokens),
                        note:
                            s.estimated_calls > 0
                                ? `${s.estimated_calls} of ${s.calls} calls priced from model list prices (the gateway did not report a cost). Metering started Sep 23, 2026.`
                                : 'Metering started Sep 23, 2026.',
                        ...(isOwner && s.chats
                            ? {
                                  by_member: s.chats.map((c) => ({
                                      who: c.chat_guid === chatGuid ? 'you' : c.handle ?? 'unknown',
                                      cost: usd(Number(c.cost_usd)),
                                      calls: c.calls,
                                  })),
                              }
                            : {}),
                    },
                }
            } catch (err) {
                return { success: false, error: err instanceof Error ? err.message : String(err) }
            }
        },
    }
}
