import OpenAI from 'openai'
import { logger } from '@/lib/logger'

let client: OpenAI | null = null

function getClient(): OpenAI {
  if (!client) client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY ?? '' })
  return client
}

export async function embedText(text: string): Promise<number[] | null> {
  try {
    const res = await getClient().embeddings.create({
      model: 'text-embedding-3-small',
      input: text.slice(0, 8000),
    })
    return res.data[0]?.embedding ?? null
  } catch (err) {
    logger.error('Embedding failed', {
      error: err instanceof Error ? err.message : String(err),
    })
    return null // non-fatal: memory stored without embedding, still keyword-searchable
  }
}
