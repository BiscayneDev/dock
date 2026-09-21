import { createServerClient } from '@/lib/supabase/server'
import { logger } from '@/lib/logger'
import { embedText } from './embeddings'

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
        if (embedding) row.embedding = embedding

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
