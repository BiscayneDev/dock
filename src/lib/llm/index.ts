import type { LLMProvider } from './types'
import { AnthropicProvider } from './anthropic'
import { OpenAIProvider } from './openai'

export type LLMProviderName = 'anthropic' | 'openai' | 'usepod'

export interface GetLLMProviderOptions {
  /** Override the provider for this call. If unset, falls back to LLM_PROVIDER env. */
  provider?: LLMProviderName
}

export interface ActiveProviderInfo {
  provider: LLMProviderName
  model: string
}

function resolveProviderName(opts?: GetLLMProviderOptions): LLMProviderName {
  const name = (opts?.provider ?? process.env.LLM_PROVIDER ?? 'anthropic') as string
  if (name !== 'anthropic' && name !== 'openai' && name !== 'usepod') {
    throw new Error(
      `Unknown LLM provider: ${name}. Use 'anthropic', 'openai', or 'usepod'.`,
    )
  }
  return name
}

function buildProvider(name: LLMProviderName): LLMProvider {
  switch (name) {
    case 'anthropic':
      return new AnthropicProvider()
    case 'openai':
      return new OpenAIProvider()
    case 'usepod': {
      const token = process.env.USEPOD_TOKEN
      if (!token) {
        throw new Error(
          "LLM_PROVIDER=usepod requires USEPOD_TOKEN. Get one at https://usepod.ai/dashboard and fund the balance.",
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
 * Returns the LLM provider for this request. Prefers the explicit
 * `provider` override (typically loaded from user preferences) and falls
 * back to the `LLM_PROVIDER` env var. No caching — provider construction
 * is cheap and per-user routing means a single cache would be incorrect.
 */
export function getLLMProvider(opts?: GetLLMProviderOptions): LLMProvider {
  return buildProvider(resolveProviderName(opts))
}

/**
 * Lightweight metadata about the provider/model currently in use. Useful
 * for injecting "you are running on X" into the system prompt so the
 * agent can answer questions about its own runtime.
 */
export function getActiveProviderInfo(opts?: GetLLMProviderOptions): ActiveProviderInfo {
  const provider = resolveProviderName(opts)
  const built = buildProvider(provider)
  const model =
    'defaultModel' in built && typeof built.defaultModel === 'string'
      ? built.defaultModel
      : 'unknown'
  return { provider, model }
}

export { type LLMProvider } from './types'
