import { createServerClient } from '@/lib/supabase/server'
import { getLLMProvider } from '@/lib/llm/index'
import { logger } from '@/lib/logger'
import {
  rememberMemories,
  getActiveMemories,
} from './store'

interface ExtractedFact {
  content: string
  type: string
}

interface ExtractionResult {
  facts: ExtractedFact[]
}

// Determine the right lightweight model for the current LLM provider
function getExtractionModel(): string {
  const provider = process.env.LLM_PROVIDER ?? 'anthropic'
  return provider === 'openai' ? 'gpt-4o-mini' : 'claude-haiku-4-5-20251001'
}

const VALID_TYPES = new Set(['fact', 'person', 'preference', 'org', 'event'])

/**
 * Extract durable facts about the user from recent conversation history
 * and store them in the memories table. Runs in the background every
 * ~10 messages. Never blocks the main flow; every failure is logged
 * and swallowed.
 */
export async function extractMemories(userId: string): Promise<void> {
  try {
    const supabase = createServerClient()

    // Fetch recent messages
    const { data: messages } = await supabase
      .from('messages')
      .select('role, content')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(30)

    if (!messages || messages.length < 5) return

    const conversationText = messages
      .filter((m) => m.content)
      .reverse()
      .map((m) => `${m.role}: ${m.content}`)
      .join('\n')
      .slice(0, 3000)

    const existing = await getActiveMemories(userId, 30)

    const llm = getLLMProvider()

    const response = await llm.chat({
      system: `extract durable facts worth remembering about the user from this conversation. respond with ONLY valid JSON: {"facts": [{"content": "...", "type": "fact|person|preference|org|event"}]}
rules:
- only concrete, reusable facts (decisions, preferences, people, plans, ongoing situations)
- include the date/time when the fact is time-bound (e.g. "flight to NYC on Oct 3")
- no transient chatter, no questions, no filler
- max 5 facts; omit facts already covered by the existing memories listed below
existing memories: ${JSON.stringify(existing.map((m) => m.content))}`,
      messages: [{ role: 'user', content: conversationText }],
      tools: [],
      model: getExtractionModel(),
      maxTokens: 300,
    })

    const text = response.content ?? ''
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return

    const parsed = JSON.parse(jsonMatch[0]) as ExtractionResult
    const facts = (parsed.facts ?? [])
      .filter(
        (f): f is ExtractedFact =>
          typeof f?.content === 'string' &&
          f.content.trim().length > 0 &&
          typeof f?.type === 'string' &&
          VALID_TYPES.has(f.type),
      )
      .slice(0, 5)

    if (facts.length === 0) return

    await rememberMemories(userId, facts)
  } catch (err) {
    logger.warn('Memory extraction failed', {
      userId,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}
