import OpenAI from 'openai'
import { createServerClient } from '@/lib/supabase/server'
import { logger } from '@/lib/logger'

// Semantic memory (RAG): embed salient facts / conversation summaries and recall
// them by similarity. Every operation degrades gracefully — if embeddings or the
// `memories` table aren't available, storage is a no-op and recall returns [].

const EMBED_MODEL = 'text-embedding-3-small' // 1536 dims, matches migration 010

export type MemoryKind = 'fact' | 'conversation_summary' | 'message'

let client: OpenAI | null = null
function getClient(): OpenAI {
  if (!client) client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  return client
}

async function embed(text: string): Promise<number[] | null> {
  if (!process.env.OPENAI_API_KEY) return null
  try {
    const res = await getClient().embeddings.create({
      model: EMBED_MODEL,
      input: text.slice(0, 8000),
    })
    return res.data[0]?.embedding ?? null
  } catch (err) {
    logger.error('embed failed', { error: err instanceof Error ? err.message : String(err) })
    return null
  }
}

export async function storeMemory(
  userId: string,
  content: string,
  kind: MemoryKind = 'fact',
  sourceMessageId?: string
): Promise<void> {
  const trimmed = content.trim()
  if (!trimmed) return

  const embedding = await embed(trimmed)
  if (!embedding) return

  try {
    const supabase = createServerClient()
    await supabase.from('memories').insert({
      user_id: userId,
      kind,
      content: trimmed,
      embedding,
      source_message_id: sourceMessageId ?? null,
    })
  } catch (err) {
    logger.error('storeMemory failed', { error: err instanceof Error ? err.message : String(err) })
  }
}

// Return up to k memory contents most relevant to queryText.
export async function recallMemories(
  userId: string,
  queryText: string,
  k = 6
): Promise<string[]> {
  const trimmed = queryText?.trim()
  if (!trimmed) return []

  const embedding = await embed(trimmed)
  if (!embedding) return []

  try {
    const supabase = createServerClient()
    const { data, error } = await supabase.rpc('match_memories', {
      query_embedding: embedding,
      match_user: userId,
      match_count: k,
    })
    if (error || !data) return []
    return (data as Array<{ content: string }>).map((r) => r.content).filter(Boolean)
  } catch (err) {
    logger.error('recallMemories failed', { error: err instanceof Error ? err.message : String(err) })
    return []
  }
}
