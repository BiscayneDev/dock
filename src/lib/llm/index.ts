import type { LLMProvider } from './types'
import { AnthropicProvider } from './anthropic'
import { OpenAIProvider } from './openai'

let cachedProvider: LLMProvider | null = null

function createUsePodProvider(): LLMProvider {
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
    case 'usepod':
      cachedProvider = createUsePodProvider()
      break
    default:
      throw new Error(
        `Unknown LLM provider: ${providerName}. Use 'anthropic', 'openai', or 'usepod'.`,
      )
  }

  return cachedProvider
}

export { type LLMProvider } from './types'
