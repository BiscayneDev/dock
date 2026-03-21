import { createServerClient } from '@/lib/supabase/server'
import { getLLMProvider } from '@/lib/llm/index'
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

export async function fetchConversationHistory(userId: string): Promise<ChatMessage[]> {
  const supabase = createServerClient()

  // Count total messages
  const { count } = await supabase
    .from('messages')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)

  // If over threshold, summarize older messages
  if ((count ?? 0) > SUMMARIZE_THRESHOLD) {
    await summarizeOldMessages(userId)
  }

  // Fetch last N messages
  const { data, error } = await supabase
    .from('messages')
    .select('id, role, content, tool_calls, tool_results, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
    .limit(MAX_CONTEXT_MESSAGES)

  if (error || !data) {
    return []
  }

  return data.map(dbMessageToChatMessage)
}

async function summarizeOldMessages(userId: string): Promise<void> {
  const supabase = createServerClient()

  // Fetch the oldest messages to summarize
  const { data: oldMessages, error } = await supabase
    .from('messages')
    .select('id, role, content, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
    .limit(SUMMARIZE_COUNT)

  if (error || !oldMessages || oldMessages.length < SUMMARIZE_COUNT) {
    return
  }

  // Build text to summarize
  const conversationText = oldMessages
    .filter((m) => m.content)
    .map((m) => `${m.role}: ${m.content}`)
    .join('\n')

  if (!conversationText.trim()) {
    return
  }

  try {
    const llm = getLLMProvider()
    const response = await llm.chat({
      system: 'You are a conversation summarizer. Create a concise summary of the following conversation, preserving key facts, decisions, and context the user might need later. Keep it under 500 words.',
      messages: [{ role: 'user', content: conversationText }],
      tools: [],
      model: 'claude-haiku-4-5-20251001',
      maxTokens: 1024,
    })

    const summary = response.content
    if (!summary) return

    // Delete the old messages
    const idsToDelete = oldMessages.map((m) => m.id)
    await supabase
      .from('messages')
      .delete()
      .in('id', idsToDelete)

    // Insert synthetic summary message
    await supabase
      .from('messages')
      .insert({
        user_id: userId,
        role: 'assistant',
        content: `[Previous conversation summary]\n${summary}`,
        created_at: oldMessages[0].created_at,
      })
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
