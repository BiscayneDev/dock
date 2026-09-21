import OpenAI from 'openai'
import { logger } from '@/lib/logger'

// Embeddings must be deployment-wide consistent (same model + dimensions for
// every vector in the index), so this is env-configured per deployment, NOT
// per user. Point EMBEDDINGS_BASE_URL at any OpenAI-compatible gateway
// (e.g. Shipyard Inference /v1) to avoid a direct OpenAI dependency.
const EMBEDDINGS_BASE_URL = process.env.EMBEDDINGS_BASE_URL
const EMBEDDINGS_API_KEY = process.env.EMBEDDINGS_API_KEY ?? process.env.OPENAI_API_KEY
const EMBEDDINGS_MODEL = process.env.EMBEDDINGS_MODEL ?? 'text-embedding-3-small'

let client: OpenAI | null = null

function getClient(): OpenAI {
  if (!client) {
    client = new OpenAI({
      apiKey: EMBEDDINGS_API_KEY ?? '',
      ...(EMBEDDINGS_BASE_URL ? { baseURL: EMBEDDINGS_BASE_URL } : {}),
    })
  }
  return client
}

export async function embedText(text: string): Promise<number[] | null> {
  if (!EMBEDDINGS_API_KEY) {
    logger.warn('No embeddings key configured (EMBEDDINGS_API_KEY / OPENAI_API_KEY)')
    return null
  }
  try {
    const res = await getClient().embeddings.create({
      model: EMBEDDINGS_MODEL,
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
