import type { LLMProvider } from './types'
import { AnthropicProvider } from './anthropic'
import { OpenAIProvider } from './openai'
import { createShipyardProvider } from './shipyard'

export type LLMProviderName = 'shipyard' | 'anthropic' | 'openai' | 'usepod'

export interface GetLLMProviderOptions {
  /** Override the provider for this call. If unset, falls back to LLM_PROVIDER env, then 'shipyard'. */
  provider?: LLMProviderName
  /** End user, for per-user savings attribution (used by the 'shipyard' router). */
  userId?: string
}

export interface ActiveProviderInfo {
  provider: LLMProviderName
  model: string
}

function resolveProviderName(opts?: GetLLMProviderOptions): LLMProviderName {
  // Default to the cost-routing 'shipyard' Router so every call is cheapest-capable
  // + cached + measured. Set LLM_PROVIDER=anthropic|openai|usepod to bypass it.
  const name = (opts?.provider ?? process.env.LLM_PROVIDER ?? 'shipyard') as string
  if (name !== 'shipyard' && name !== 'anthropic' && name !== 'openai' && name !== 'usepod') {
    throw new Error(
      `Unknown LLM provider: ${name}. Use 'shipyard', 'anthropic', 'openai', or 'usepod'.`,
    )
  }
  return name
}

function buildProvider(name: LLMProviderName, userId?: string): LLMProvider {
  switch (name) {
    case 'shipyard':
      return createShipyardProvider({ userId })
    case 'anthropic':
      return new AnthropicProvider()
    case 'openai':
      return new OpenAIProvider()
    case 'usepod': {
      const token = process.env.USEPOD_TOKEN
      if (!token) {
        throw new Error(
          "LLM_PROVIDER=usepod requires USEPOD_TOKEN. Get one at https://usepod.ai and fund the balance.",
        )
      }
      return new AnthropicProvider({
        apiKey: 'UsePod',
        baseURL: `https://api.usepod.ai/proxy/${token}`,
      })
    }
  }
}

/**
 * Returns the LLM provider for this request. Defaults to the 'shipyard' cost-aware
 * Router (cheapest capable model + prompt caching + savings telemetry). Prefers an
 * explicit `provider` override (e.g. from user preferences), then `LLM_PROVIDER`.
 * No caching — construction is cheap and per-user routing means a shared instance
 * would be incorrect.
 */
export function getLLMProvider(opts?: GetLLMProviderOptions): LLMProvider {
  return buildProvider(resolveProviderName(opts), opts?.userId)
}

/**
 * Lightweight metadata about the provider/model currently in use. Useful for
 * injecting "you are running on X" into the system prompt so the agent can answer
 * questions about its own runtime.
 */
export function getActiveProviderInfo(opts?: GetLLMProviderOptions): ActiveProviderInfo {
  const provider = resolveProviderName(opts)
  const built = buildProvider(provider, opts?.userId)
  const model =
    'defaultModel' in built && typeof built.defaultModel === 'string'
      ? built.defaultModel
      : 'unknown'
  return { provider, model }
}

export { type LLMProvider } from './types'
