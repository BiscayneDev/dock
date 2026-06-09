import { createServerClient } from '@/lib/supabase/server'
import { getLLMProvider } from '@/lib/llm/index'
import { storeMemory } from '@/lib/memory/semantic'
import { logger } from '@/lib/logger'

interface UserPreferences {
  communication_style?: string
  important_contacts?: string[]
  common_topics?: string[]
  quirks?: string[]
}

// Extracted alongside preferences but stored in semantic memory, not on the
// user row — richer durable facts (projects, goals, people, decisions).
interface Extraction extends UserPreferences {
  facts?: string[]
}

/**
 * Extract user preferences from recent conversation history.
 * Runs in the background every ~10 messages. Never blocks the main flow.
 */
export async function extractPreferences(userId: string): Promise<void> {
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

  // Fetch existing preferences
  const { data: user } = await supabase
    .from('users')
    .select('preferences')
    .eq('id', userId)
    .single()

  const existing = (user?.preferences as UserPreferences) ?? {}

  const llm = getLLMProvider()

  const response = await llm.chat({
    system: `extract user preferences and durable facts from this conversation. respond with ONLY valid JSON:
{
  "communication_style": "brief" | "detailed" | "casual" | null,
  "important_contacts": ["name or email they mention often"],
  "common_topics": ["topics they frequently ask about"],
  "quirks": ["notable preferences, habits, or pet peeves"],
  "facts": ["durable facts worth remembering long-term: projects, goals, people, commitments, decisions"]
}

rules:
- only include fields where you have real evidence from the conversation
- keep arrays short (max 5 items each)
- quirks should be actionable (e.g. "prefers morning meetings" not "seems busy")
- facts should be specific and standalone (e.g. "launching a podcast called Harbor in March")
- if you can't determine something, omit the field entirely
- merge with existing preferences where provided

existing preferences: ${JSON.stringify(existing)}`,
    messages: [{ role: 'user', content: conversationText }],
    tools: [],
    maxTokens: 400,
  })

  try {
    const text = response.content ?? '{}'
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return

    const extracted = JSON.parse(jsonMatch[0]) as Extraction

    // Store durable facts in semantic memory (best-effort, non-blocking flow).
    for (const fact of (extracted.facts ?? []).slice(0, 5)) {
      if (typeof fact === 'string' && fact.trim()) {
        await storeMemory(userId, fact, 'fact')
      }
    }

    // Merge immutably with existing — arrays are unioned, scalars overwritten
    const merged: UserPreferences = {
      communication_style: extracted.communication_style ?? existing.communication_style,
      important_contacts: dedupeArray([
        ...(existing.important_contacts ?? []),
        ...(extracted.important_contacts ?? []),
      ]).slice(0, 5),
      common_topics: dedupeArray([
        ...(existing.common_topics ?? []),
        ...(extracted.common_topics ?? []),
      ]).slice(0, 5),
      quirks: dedupeArray([
        ...(existing.quirks ?? []),
        ...(extracted.quirks ?? []),
      ]).slice(0, 5),
    }

    await supabase
      .from('users')
      .update({ preferences: merged })
      .eq('id', userId)
  } catch (err) {
    logger.error('Preference extraction failed', {
      userId,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

function dedupeArray(arr: string[]): string[] {
  const seen = new Set<string>()
  return arr.filter((item) => {
    const lower = item.toLowerCase()
    if (seen.has(lower)) return false
    seen.add(lower)
    return true
  })
}
