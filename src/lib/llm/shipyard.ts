import {
  Router,
  createOpenRouterProvider,
  createUsePodProvider,
  costOptimized,
  type ProviderCandidate,
  type ModelMetadata,
  type UsageRecord,
} from 'shipyard-inference'
import type { LLMProvider, LLMChatParams, LLMResponse } from './types'
import { createServerClient } from '@/lib/supabase/server'
import { logger } from '@/lib/logger'

/**
 * The model Dock would otherwise have called for a request that doesn't pin one.
 * This is the savings BASELINE — "cheaper than calling <DEFAULT_MODEL> direct."
 */
const DEFAULT_MODEL = process.env.LLM_MODEL ?? 'anthropic/claude-sonnet-4.5'

/**
 * Margin added on top of the routed (actual) cost when billing the user's Paybox
 * wallet. `charged = actual * (1 + margin)`, clamped to the baseline so the user
 * never pays more than calling the model direct. Default 15%. See settle.ts.
 */
const MARGIN = Number(process.env.SHIPYARD_MARGIN_PCT ?? '15') / 100

/** What we bill the user for a request: actual + margin, never above baseline. */
function computeChargedUsd(actual: number | null, baseline: number | null): number | null {
  if (actual == null) return null // unpriced request → not billable
  const withMargin = actual * (1 + MARGIN)
  if (baseline == null) return withMargin // no baseline to clamp against
  return Math.min(withMargin, baseline) // user always still saves vs direct
}

// The routable catalog, served through OpenRouter (one key fronting many
// vendors). `tier` drives the per-request quality floor (autoTier picks the
// cheapest model *at or above* the inferred tier); rates are OpenRouter's live
// $/1M and feed cost ranking + the savings math. Open-weight models are the
// cheap-but-capable `standard` tier (a general request lands on DeepSeek V3.2 at
// ~$0.23/$0.34 instead of Sonnet at $3/$15 — comparable quality, ~13× cheaper).
// Cheap text-only models omit `vision`, so image requests fall to a vision model.
const OPENROUTER_MODELS: ModelMetadata[] = [
  // economy — short/simple requests
  { model: 'meta-llama/llama-3.3-70b-instruct', inputCostPerMTok: 0.1, outputCostPerMTok: 0.32, contextWindow: 131_072, tier: 'economy', capabilities: ['tools', 'json'] },
  { model: 'openai/gpt-4o-mini', inputCostPerMTok: 0.15, outputCostPerMTok: 0.6, contextWindow: 128_000, tier: 'economy', capabilities: ['tools', 'vision', 'json'] },
  { model: 'anthropic/claude-haiku-4.5', inputCostPerMTok: 1, outputCostPerMTok: 5, contextWindow: 200_000, tier: 'economy', capabilities: ['tools', 'vision', 'json'] },
  // standard — general / tool-using requests; cheapest here = open-weight
  { model: 'deepseek/deepseek-v3.2', inputCostPerMTok: 0.23, outputCostPerMTok: 0.34, contextWindow: 131_072, tier: 'standard', capabilities: ['tools', 'json'] },
  { model: 'qwen/qwen3-235b-a22b', inputCostPerMTok: 0.46, outputCostPerMTok: 1.82, contextWindow: 131_072, tier: 'standard', capabilities: ['tools', 'json'] },
  { model: 'google/gemini-2.5-flash', inputCostPerMTok: 0.3, outputCostPerMTok: 2.5, contextWindow: 1_048_576, tier: 'standard', capabilities: ['tools', 'vision', 'json'] },
  { model: 'openai/gpt-4o', inputCostPerMTok: 2.5, outputCostPerMTok: 10, contextWindow: 128_000, tier: 'standard', capabilities: ['tools', 'vision', 'json'] },
  { model: 'anthropic/claude-sonnet-4.5', inputCostPerMTok: 3, outputCostPerMTok: 15, contextWindow: 1_000_000, tier: 'standard', capabilities: ['tools', 'vision', 'json'] },
  // frontier — long-context / complex / large-output requests
  { model: 'anthropic/claude-opus-4.5', inputCostPerMTok: 5, outputCostPerMTok: 25, contextWindow: 200_000, tier: 'frontier', capabilities: ['tools', 'vision', 'json'] },
]

function buildCandidates(): ProviderCandidate[] {
  const candidates: ProviderCandidate[] = []

  // Primary rail: OpenRouter — one operator-funded key fronting Claude / GPT /
  // Gemini + open-weight. The Router picks the cheapest model at the request's
  // quality floor across this whole catalog.
  if (process.env.OPENROUTER_API_KEY) {
    candidates.push({
      id: 'openrouter',
      provider: createOpenRouterProvider({ apiKey: process.env.OPENROUTER_API_KEY }),
      models: OPENROUTER_MODELS,
    })
  }

  // Resilience floor: UsePod — wallet-funded (x402), NO API key, so it keeps
  // serving even if the OpenRouter key is throttled or cut. Commodity tier.
  if (process.env.USEPOD_TOKEN) {
    candidates.push({
      id: 'usepod',
      provider: createUsePodProvider({ token: process.env.USEPOD_TOKEN, family: 'openai' }),
      models: [
        { model: 'gpt-4o-mini', inputCostPerMTok: 0.1, outputCostPerMTok: 0.4, contextWindow: 128_000, tier: 'economy', capabilities: ['tools', 'json'] },
      ],
    })
  }

  if (candidates.length === 0) {
    throw new Error(
      '[shipyard] no inference candidates configured — set OPENROUTER_API_KEY (and/or USEPOD_TOKEN)',
    )
  }
  return candidates
}

/**
 * Persist each completed request's usage + savings to Supabase. Fire-and-forget
 * so it never blocks the response path; failures are logged, not thrown.
 */
function supabaseRecorder() {
  return {
    record(r: UsageRecord): void {
      void (async () => {
        try {
          const supabase = createServerClient()
          const { error } = await supabase.from('inference_usage').insert({
            user_id: r.userId ?? null,
            model: r.model ?? null,
            candidate: r.candidateId,
            input_tokens: r.usage?.inputTokens ?? 0,
            output_tokens: r.usage?.outputTokens ?? 0,
            cache_read_tokens: r.usage?.cacheReadTokens ?? 0,
            cache_write_tokens: r.usage?.cacheWriteTokens ?? 0,
            actual_cost_usd: r.actualCostUsd ?? null,
            baseline_cost_usd: r.baselineCostUsd ?? null,
            saved_usd: r.savedUsd ?? null,
            charged_usd: computeChargedUsd(r.actualCostUsd ?? null, r.baselineCostUsd ?? null),
            latency_ms: Math.round(r.latencyMs),
          })
          if (error) throw error
        } catch (err) {
          logger.error('inference_usage insert failed', {
            error: err instanceof Error ? err.message : String(err),
          })
        }
      })()
    },
  }
}

export interface ShipyardProviderOptions {
  /** End user, for per-user savings attribution. */
  userId?: string
}

/**
 * Dock's `LLMProvider`, backed by the shipyard-inference `Router`: cost-routes
 * across Anthropic / OpenAI / UsePod to the cheapest capable model, with
 * Anthropic prompt caching on, and records per-request savings (vs the model the
 * call intended) to Supabase. Drop-in — the `chat()` shape is identical, so no
 * call sites change.
 */
export function createShipyardProvider(
  opts: ShipyardProviderOptions = {},
): LLMProvider & { defaultModel: string } {
  const router = new Router({
    candidates: buildCandidates(),
    strategy: costOptimized(),
    usageRecorder: supabaseRecorder(),
    // Per-request quality floor: route to the cheapest model that's good enough
    // for the request (short ⇒ economy, tools/general ⇒ standard ⇒ open-weight,
    // long/complex ⇒ frontier), rather than the globally cheapest.
    autoTier: true,
    // Savings are measured against calling the premium model (Sonnet) direct.
    baselineModel: DEFAULT_MODEL,
  })

  return {
    defaultModel: DEFAULT_MODEL,
    async chat(params: LLMChatParams): Promise<LLMResponse> {
      const intended = params.model ?? DEFAULT_MODEL
      // The Router returns a superset response (adds `usage`); structurally an
      // LLMResponse. `metadata.userId` tags the savings for this user.
      return router.chat({
        ...params,
        model: intended,
        metadata: { userId: opts.userId },
      })
    },
  }
}
