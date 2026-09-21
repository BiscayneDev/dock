import { createServerClient } from '@/lib/supabase/server'
import { logger } from '@/lib/logger'
import { embedText, currentEmbeddingModel } from './embeddings'

export interface MemorizableFact {
  content: string
  type: string
  sourceMessageId?: string
}

export interface MemorySearchResult {
  id: string
  type: string
  content: string
  valid_from: string
  similarity: number
}

export interface KeywordMessageResult {
  role: string
  content: string
  created_at: string
}

const DUPLICATE_SIMILARITY_THRESHOLD = 0.92

/** Escape LIKE wildcards in user-provided search text. */
function escapeLike(text: string): string {
  return text.replace(/[%_]/g, (m) => `\\${m}`)
}

/** True when a similarity score indicates the fact is already stored. */
export function isDuplicate(similarity: number): boolean {
  return similarity > DUPLICATE_SIMILARITY_THRESHOLD
}

/** Filter new facts against existing contents and dedupe among themselves. */
export function mergeMemorizableFacts(
  newFacts: { content: string; type: string }[],
  existingContents: string[],
): { content: string; type: string }[] {
  const existing = new Set(existingContents.map((c) => c.toLowerCase().trim()))
  const seen = new Set<string>()
  const result: { content: string; type: string }[] = []
  for (const fact of newFacts) {
    const key = fact.content.toLowerCase().trim()
    if (existing.has(key) || seen.has(key)) continue
    seen.add(key)
    result.push(fact)
  }
  return result
}

/**
 * Store facts as memories. Embeds each fact, skips duplicates (>0.92
 * similarity via match_memories), inserts rows. Returns count inserted.
 * Never throws — failures are logged and skipped.
 */
export async function rememberMemories(
  userId: string,
  facts: MemorizableFact[],
): Promise<number> {
  try {
    const supabase = createServerClient()
    let inserted = 0
    for (const fact of facts) {
      try {
        const embedding = await embedText(fact.content)

        // Duplicate check via vector similarity when we have an embedding
        if (embedding) {
          const { data: matches, error: matchError } = await supabase.rpc(
            'match_memories',
            { p_user_id: userId, p_embedding: embedding, p_limit: 1 },
          )
          if (!matchError && matches && matches.length > 0) {
            const top = matches[0] as { similarity: number }
            if (isDuplicate(top.similarity)) continue
          }
        }

        const row: Record<string, unknown> = {
          user_id: userId,
          type: fact.type,
          content: fact.content,
        }
        if (fact.sourceMessageId) row.source_message_id = fact.sourceMessageId
        if (embedding) {
          row.embedding = embedding
          row.embedding_model = currentEmbeddingModel()
        }

        const { error: insertError } = await supabase
          .from('memories')
          .insert(row)
        if (insertError) throw insertError
        inserted += 1
      } catch (err) {
        logger.error('rememberMemories: failed to store fact', {
          error: err instanceof Error ? err.message : String(err),
          })
      }
    }
    return inserted
  } catch (err) {
    logger.error('rememberMemories failed', {
      error: err instanceof Error ? err.message : String(err),
      })
    return 0
  }
}

/** Keyword fallback over memory contents (used when embeddings are unavailable). */
async function keywordSearchMemories(
  userId: string,
  query: string,
  limit: number,
): Promise<MemorySearchResult[]> {
  try {
    const supabase = createServerClient()
    const { data, error } = await supabase
      .from('memories')
      .select('id, type, content, valid_from')
      .eq('user_id', userId)
      .is('superseded_at', null)
      .ilike('content', `%${escapeLike(query)}%`)
      .order('valid_from', { ascending: false })
      .limit(limit)
    if (error) throw error
    return ((data ?? []) as MemorySearchResult[]).map((m) => ({ ...m, similarity: 0 }))
  } catch (err) {
    logger.error('keywordSearchMemories failed', {
      error: err instanceof Error ? err.message : String(err),
    })
    return []
  }
}

/**
 * Detect an embedding-model switch: if existing vectors were produced by a
 * different model than the current one, comparing them by cosine distance is
 * meaningless. Returns the stale model name, or null when consistent.
 */
async function detectStaleEmbeddingModel(supabase: ReturnType<typeof createServerClient>): Promise<string | null> {
  try {
    const { data } = await supabase
      .from('memories')
      .select('embedding_model')
      .not('embedding', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1)
    const stored = (data ?? [])[0]?.embedding_model as string | null | undefined
    if (stored && stored !== currentEmbeddingModel()) return stored
    return null
  } catch {
    return null // detection is best-effort; never block search
  }
}

// Prevent concurrent re-embed passes (multiple simultaneous requests).
let reembedInFlight = false

const REEMBED_BATCH_SIZE = 200

/**
 * Re-embed all memories tagged with a stale model using the current model,
 * then retag them. Fire-and-forget: search falls back to keyword results
 * while this runs. Never throws.
 */
async function reembedStaleMemories(staleModel: string): Promise<void> {
  if (reembedInFlight) return
  reembedInFlight = true
  try {
    const supabase = createServerClient()
    const { data: stale } = await supabase
      .from('memories')
      .select('id, content')
      .eq('embedding_model', staleModel)
      .not('embedding', 'is', null)
      .limit(REEMBED_BATCH_SIZE)
    if (!stale || stale.length === 0) return

    logger.warn('Embedding model changed — re-embedding memories', {
      staleModel,
      currentModel: currentEmbeddingModel(),
      count: stale.length,
    })

    let fixed = 0
    for (const m of stale) {
      const embedding = await embedText(m.content)
      if (!embedding) continue
      const { error } = await supabase
        .from('memories')
        .update({ embedding, embedding_model: currentEmbeddingModel() })
        .eq('id', m.id)
      if (!error) fixed += 1
    }
    logger.warn('Re-embed pass complete', { fixed, total: stale.length })
  } catch (err) {
    logger.error('reembedStaleMemories failed', {
      error: err instanceof Error ? err.message : String(err),
    })
  } finally {
    reembedInFlight = false
  }
}

/** Semantic search over memories via the match_memories RPC. */
export async function searchMemories(
  userId: string,
  query: string,
  limit = 8,
): Promise<MemorySearchResult[]> {
  try {
    const embedding = await embedText(query)
    if (!embedding) {
      // Embedding unavailable — fall back to keyword matching over memory contents
      return keywordSearchMemories(userId, query, limit)
    }

    const supabase = createServerClient()

    // Model-switch guard: existing vectors from a different model would make
    // cosine search meaningless. Serve keyword results and heal in background.
    const staleModel = await detectStaleEmbeddingModel(supabase)
    if (staleModel) {
      void reembedStaleMemories(staleModel)
      return keywordSearchMemories(userId, query, limit)
    }

    let { data, error } = await supabase.rpc('match_memories', {
      p_user_id: userId,
      p_embedding: embedding,
      p_limit: limit,
    })

    // Retry with JSON string if the array param was rejected
    if (error) {
      const retry = await supabase.rpc('match_memories', {
        p_user_id: userId,
        p_embedding: JSON.stringify(embedding),
        p_limit: limit,
      })
      data = retry.data
      error = retry.error
    }

    if (error) throw error
    return (data ?? []) as MemorySearchResult[]
  } catch (err) {
    logger.error('searchMemories failed', {
      error: err instanceof Error ? err.message : String(err),
      })
    return keywordSearchMemories(userId, query, limit)
  }
}

/** Keyword search across ALL messages (compacted included), newest first. */
export async function keywordSearchMessages(
  userId: string,
  query: string,
): Promise<KeywordMessageResult[]> {
  try {
    const supabase = createServerClient()
    const { data, error } = await supabase
      .from('messages')
      .select('role, content, created_at')
      .eq('user_id', userId)
      .ilike('content', `%${escapeLike(query)}%`)
      .order('created_at', { ascending: false })
      .limit(10)
    if (error) throw error
    return (data ?? []) as KeywordMessageResult[]
  } catch (err) {
    logger.error('keywordSearchMessages failed', {
      error: err instanceof Error ? err.message : String(err),
      })
    return []
  }
}

/** Mark active memories matching a content substring as superseded. */
export async function supersedeMemory(
  userId: string,
  contentSubstring: string,
): Promise<number> {
  if (contentSubstring.trim().length < 4) {
    logger.warn('supersedeMemory refused: query too short to match safely')
    return 0
  }
  try {
    const supabase = createServerClient()
    const { data, error } = await supabase
      .from('memories')
      .update({ superseded_at: new Date().toISOString() })
      .eq('user_id', userId)
      .is('superseded_at', null)
      .ilike('content', `%${escapeLike(contentSubstring)}%`)
      .select()
    if (error) throw error
    return (data ?? []).length
  } catch (err) {
    logger.error('supersedeMemory failed', {
      error: err instanceof Error ? err.message : String(err),
      })
    return 0
  }
}

/** Fetch active (non-superseded) memories, newest first. */
export async function getActiveMemories(
  userId: string,
  limit = 50,
): Promise<{ content: string; type: string; valid_from: string }[]> {
  try {
    const supabase = createServerClient()
    const { data, error } = await supabase
      .from('memories')
      .select('content, type, valid_from')
      .eq('user_id', userId)
      .is('superseded_at', null)
      .order('valid_from', { ascending: false })
      .limit(limit)
    if (error) throw error
    return (data ?? []) as { content: string; type: string; valid_from: string }[]
  } catch (err) {
    logger.error('getActiveMemories failed', {
      error: err instanceof Error ? err.message : String(err),
      })
    return []
  }
}
