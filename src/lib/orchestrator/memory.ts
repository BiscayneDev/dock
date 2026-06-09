import { createServerClient } from '@/lib/supabase/server'
import { getLLMProvider, type LLMProviderName } from '@/lib/llm/index'
import { storeMemory } from '@/lib/memory/semantic'
import type { ChatMessage } from '@/lib/llm/types'

const MAX_CONTEXT_MESSAGES = 50
const SUMMARIZE_THRESHOLD = 50
const SUMMARIZE_COUNT = 30

interface DbMessage {
  id: string
  role: string
  content: string | null
  tool_calls: unknown | null
  tool_results: unknown | null
  created_at: string
}

// Determine the right lightweight model for the active LLM provider
function getSummarizationModel(provider?: LLMProviderName): string {
  const resolved = provider ?? (process.env.LLM_PROVIDER as LLMProviderName | undefined) ?? 'anthropic'
  return resolved === 'openai' ? 'gpt-4o-mini' : 'claude-haiku-4-5-20251001'
}

export async function fetchConversationHistory(
  userId: string,
  provider?: LLMProviderName
): Promise<ChatMessage[]> {
  const supabase = createServerClient()

  // Count total messages
  const { count } = await supabase
    .from('messages')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)

  // If over threshold, summarize older messages
  if ((count ?? 0) > SUMMARIZE_THRESHOLD) {
    await summarizeOldMessages(userId, provider)
  }

  // Fetch the NEWEST N messages (descending), then reverse for chronological order.
  // This ensures the agent always has recent context even if summarization fails.
  const { data, error } = await supabase
    .from('messages')
    .select('id, role, content, tool_calls, tool_results, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(MAX_CONTEXT_MESSAGES)

  if (error || !data) {
    return []
  }

  // Reverse to get chronological order (oldest first)
  return data.reverse().map(dbMessageToChatMessage)
}

// When the message count grows past the active window, summarize the oldest
// messages into durable semantic memory. We do NOT delete the originals — they
// stay in `messages` (auditable, re-embeddable); the recent-window fetch keeps
// the live context bounded while older context is recalled via RAG.
async function summarizeOldMessages(
  userId: string,
  provider?: LLMProviderName
): Promise<void> {
  const supabase = createServerClient()

  // Only summarize once there are enough un-summarized messages OLDER than the
  // active window — so the recent window stays untouched and nothing is folded
  // in twice (the `summarized` flag is set below instead of deleting).
  const { count: unsummarized } = await supabase
    .from('messages')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('summarized', false)

  if ((unsummarized ?? 0) <= MAX_CONTEXT_MESSAGES + SUMMARIZE_COUNT) {
    return
  }

  // Oldest un-summarized batch (chronological).
  const { data: oldMessages, error } = await supabase
    .from('messages')
    .select('id, role, content')
    .eq('user_id', userId)
    .eq('summarized', false)
    .order('created_at', { ascending: true })
    .limit(SUMMARIZE_COUNT)

  if (error || !oldMessages || oldMessages.length < SUMMARIZE_COUNT) {
    return
  }

  const conversationText = oldMessages
    .filter((m) => m.content)
    .map((m) => `${m.role}: ${m.content}`)
    .join('\n')

  if (!conversationText.trim()) {
    return
  }

  try {
    const llm = getLLMProvider({ provider })
    const response = await llm.chat({
      system:
        'You are a conversation summarizer. Create a concise summary of the following conversation, preserving key facts, decisions, and context the user might need later. Keep it under 500 words.',
      messages: [{ role: 'user', content: conversationText }],
      tools: [],
      model: getSummarizationModel(provider),
      maxTokens: 1024,
    })

    const summary = response.content
    if (!summary) return

    // Store the summary as recallable memory, then flag the originals as folded
    // in (retained, not deleted) so they're never summarized again.
    await storeMemory(userId, summary, 'conversation_summary')
    await supabase
      .from('messages')
      .update({ summarized: true })
      .in('id', oldMessages.map((m) => m.id))
  } catch {
    // Summarization failure is non-critical — proceed with unsummarized history
  }
}

export async function persistMessage(
  userId: string,
  message: ChatMessage,
  telegramMessageId?: number
): Promise<void> {
  const supabase = createServerClient()

  await supabase.from('messages').insert({
    user_id: userId,
    role: message.role,
    content: message.content,
    tool_calls: message.toolCalls ? JSON.stringify(message.toolCalls) : null,
    tool_results: message.toolResults ? JSON.stringify(message.toolResults) : null,
    telegram_message_id: telegramMessageId ?? null,
  })
}

function dbMessageToChatMessage(msg: DbMessage): ChatMessage {
  const chatMsg: ChatMessage = {
    role: msg.role as ChatMessage['role'],
    content: msg.content,
  }

  if (msg.tool_calls) {
    chatMsg.toolCalls = typeof msg.tool_calls === 'string'
      ? JSON.parse(msg.tool_calls)
      : msg.tool_calls as ChatMessage['toolCalls']
  }

  if (msg.tool_results) {
    chatMsg.toolResults = typeof msg.tool_results === 'string'
      ? JSON.parse(msg.tool_results)
      : msg.tool_results as ChatMessage['toolResults']
  }

  return chatMsg
}
