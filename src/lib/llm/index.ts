import type { LLMProvider } from './types'
import { AnthropicProvider } from './anthropic'
import { OpenAIProvider } from './openai'

let cachedProvider: LLMProvider | null = null

export function getLLMProvider(): LLMProvider {
  if (cachedProvider) {
    return cachedProvider
  }

  const providerName = process.env.LLM_PROVIDER ?? 'anthropic'

  switch (providerName) {
    case 'anthropic':
      cachedProvider = new AnthropicProvider()
      break
    case 'openai':
      cachedProvider = new OpenAIProvider()
      break
    default:
      throw new Error(`Unknown LLM provider: ${providerName}. Use 'anthropic' or 'openai'.`)
  }

  return cachedProvider
}

export { type LLMProvider } from './types'
