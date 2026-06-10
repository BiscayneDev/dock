import {
  Router,
  AnthropicProvider,
  OpenAIProvider,
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
const DEFAULT_MODEL = process.env.LLM_MODEL ?? 'claude-sonnet-4-5'

// Advisory pricing (USD per 1M tokens) for the models we route across. These
// rank candidates and compute the baseline-vs-actual savings; not billing-exact.
const ANTHROPIC_MODELS: ModelMetadata[] = [
  { model: 'claude-haiku-4-5', inputCostPerMTok: 0.8, outputCostPerMTok: 4, contextWindow: 200_000, tier: 'economy', capabilities: ['tools', 'vision', 'json'] },
  { model: 'claude-sonnet-4-5', inputCostPerMTok: 3, outputCostPerMTok: 15, contextWindow: 200_000, tier: 'standard', capabilities: ['tools', 'vision', 'json'] },
  { model: 'claude-opus-4-5', inputCostPerMTok: 5, outputCostPerMTok: 25, contextWindow: 200_000, tier: 'frontier', capabilities: ['tools', 'vision', 'json'] },
]

const OPENAI_MODELS: ModelMetadata[] = [
  { model: 'gpt-4o-mini', inputCostPerMTok: 0.15, outputCostPerMTok: 0.6, contextWindow: 128_000, tier: 'economy', capabilities: ['tools', 'vision', 'json'] },
  { model: 'gpt-4o', inputCostPerMTok: 2.5, outputCostPerMTok: 10, contextWindow: 128_000, tier: 'standard', capabilities: ['tools', 'vision', 'json'] },
]

function buildCandidates(): ProviderCandidate[] {
  const candidates: ProviderCandidate[] = [
    {
      id: 'anthropic',
      // Prompt caching is on by default — the stable system+tools prefix caches.
      provider: new AnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY }),
      models: ANTHROPIC_MODELS,
    },
  ]

  if (process.env.OPENAI_API_KEY) {
    candidates.push({
      id: 'openai',
      provider: new OpenAIProvider({ apiKey: process.env.OPENAI_API_KEY }),
      models: OPENAI_MODELS,
    })
  }

  // UsePod prepaid marketplace as a cheap commodity tier (OpenAI surface).
  if (process.env.USEPOD_TOKEN) {
    candidates.push({
      id: 'usepod',
      provider: createUsePodProvider({ token: process.env.USEPOD_TOKEN, family: 'openai' }),
      models: [
        { model: 'gpt-4o-mini', inputCostPerMTok: 0.1, outputCostPerMTok: 0.4, contextWindow: 128_000, tier: 'economy', capabilities: ['tools', 'json'] },
      ],
    })
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
    // No fixed baselineModel → baseline falls back to each request's params.model,
    // which we always set below to the intended model.
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
