/**
 * One row per gateway call, written whatever the outcome (success, deadline,
 * HTTP error, network error). inference_usage only ever saw successes, so the
 * slow turns that hit the deadline left no trace. Never throws; awaited writes are bounded to 1.5 seconds per call.
 */
import { createServerClient } from '@/lib/supabase/server'

export type GatewayOutcome = 'ok' | 'deadline' | 'http_error' | 'error'

export interface GatewayCallRow {
    chat_guid: string | null
    source: 'chat' | 'tool_loop' | 'synthesis'
    iteration: number | null
    requested_model: string | null
    resolved_model: string | null
    provider: string | null
    tier: string | null
    outcome: GatewayOutcome
    http_status: number | null
    input_tokens: number | null
    cached_tokens: number | null
    output_tokens: number | null
    latency_ms: number
    cost_usd: number | null
    tools_offered: number | null
    prompt_chars: number | null
    private_route: boolean
    deadline_left_ms: number | null
}

type HeaderBag = { headers: { get(name: string): string | null } }
type UsageBody = {
    model?: string
    usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } }
}

export interface CallContext {
    chatGuid?: string | null
    source: GatewayCallRow['source']
    iteration?: number
    requestedModel: string
    toolsOffered?: number
    promptChars?: number
    privateRoute?: boolean
    deadlineAt?: number
}

/** Build a row from whatever is known. Header names the gateway does not send stay null. */
export function buildCallRow(ctx: CallContext, outcome: GatewayOutcome, startedAt: number, res?: HeaderBag & { status?: number }, data?: UsageBody, now = Date.now()): GatewayCallRow {
    const costHeader = Number.parseFloat(res?.headers.get('x-shipyard-cost-usd') ?? '')
    return {
        chat_guid: ctx.chatGuid ?? null,
        source: ctx.source,
        iteration: ctx.iteration ?? null,
        requested_model: ctx.requestedModel,
        resolved_model: res?.headers.get('x-shipyard-model') || data?.model || null,
        provider: res?.headers.get('x-shipyard-provider') ?? null,
        tier: res?.headers.get('x-shipyard-tier') ?? null,
        outcome,
        http_status: res?.status ?? null,
        input_tokens: data?.usage?.prompt_tokens ?? null,
        cached_tokens: data?.usage?.prompt_tokens_details?.cached_tokens ?? null,
        output_tokens: data?.usage?.completion_tokens ?? null,
        latency_ms: Math.max(0, Math.round(now - startedAt)),
        cost_usd: Number.isFinite(costHeader) ? costHeader : null,
        tools_offered: ctx.toolsOffered ?? null,
        prompt_chars: ctx.promptChars ?? null,
        private_route: ctx.privateRoute ?? false,
        deadline_left_ms: ctx.deadlineAt === undefined ? null : Math.round(ctx.deadlineAt - startedAt),
    }
}

/** What was asked for: the pinned model, or `auto` plus the routing prefs actually sent. */
export function requestedLabel(pinned: string, routing: unknown): string {
    return routing ? 'auto' : pinned
}

const LOG_TIMEOUT_MS = 1500

/**
 * Awaited by callers (a fire-and-forget insert can be dropped when a serverless
 * function freezes after the reply), but capped so a slow database never holds
 * a reply for more than LOG_TIMEOUT_MS. Never throws.
 */
export async function logGatewayCall(row: GatewayCallRow): Promise<void> {
    try {
        const insert = Promise.resolve(createServerClient().from('dinghy_gateway_calls').insert(row)).then(() => undefined, () => undefined)
        let timer: ReturnType<typeof setTimeout> | undefined
        const cap = new Promise<void>((resolve) => { timer = setTimeout(resolve, LOG_TIMEOUT_MS) })
        await Promise.race([insert, cap])
        if (timer) clearTimeout(timer)
    } catch {
        // telemetry must never break a reply
    }
}
