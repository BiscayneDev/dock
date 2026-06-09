import { createServerClient } from '@/lib/supabase/server'
import { logger } from '@/lib/logger'
import { runAgentLoop } from '@/lib/llm/agent-loop'
import { getActiveProviderInfo, type LLMProviderName } from '@/lib/llm'
import { buildSystemPrompt } from './system-prompt'
import { fetchConversationHistory, persistMessage } from './memory'
import { recallMemories } from '@/lib/memory/semantic'
import { integrationTools, getOrchestratorTools } from '@/lib/tools/index'
import {
  sendMessage,
  sendChatAction,
  editMessage,
  answerCallbackQuery,
} from '@/lib/telegram/client'
import type { TelegramUpdate, TelegramMessage, TelegramCallbackQuery } from '@/lib/telegram/types'
import type { UserContext, DecryptedTokens, ChatMessage } from '@/lib/llm/types'
import { decryptTokenFromDb } from '@/lib/crypto'

// Lazy import recipe tools to avoid circular dependency
let recipeToolsLoaded: typeof import('@/lib/tools/recipes') | null = null
async function getRecipeTools(): Promise<typeof import('@/lib/tools/recipes')> {
  if (!recipeToolsLoaded) {
    recipeToolsLoaded = await import('@/lib/tools/recipes')
  }
  return recipeToolsLoaded
}

// --- Main orchestrator entry ---

export async function handleTelegramUpdate(update: TelegramUpdate): Promise<void> {
  if (update.callback_query) {
    await handleCallbackQuery(update.callback_query)
    return
  }

  if (update.message) {
    await handleMessage(update.message)
    return
  }

  // my_chat_member updates are handled silently
}

async function handleMessage(message: TelegramMessage): Promise<void> {
  const chatId = message.chat.id
  const telegramId = message.from?.id ?? chatId
  const text = message.text ?? ''

  try {
    await handleMessageInner(chatId, telegramId, text, message)
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    logger.error('handleMessage failed', {
      chatId,
      error: errorMsg,
      stack: err instanceof Error ? err.stack?.slice(0, 500) : undefined,
    })
    try {
      await sendMessage({ chatId, text: 'something went wrong — try again or rephrase' })
    } catch {
      // Can't send error message
    }
  }
}

async function handleMessageInner(chatId: number, telegramId: number, initialText: string, message: TelegramMessage): Promise<void> {
  // Send typing indicator
  await sendChatAction(chatId)

  let text = initialText

  // Handle voice messages — transcribe before processing
  if (message.voice && !text) {
    try {
      const { transcribeVoiceMessage } = await import('@/lib/voice/transcribe')
      text = await transcribeVoiceMessage(message.voice.file_id)
      // Send back what we heard so the user can verify
      await sendMessage({ chatId, text: `🎤 "${text}"` })
    } catch {
      await sendMessage({ chatId, text: "Couldn't transcribe that voice message. Try again or type it out." })
      return
    }
  }

  // If still no text (e.g. photo, sticker), bail
  if (!text) {
    await sendMessage({ chatId, text: "I can only process text and voice messages for now." })
    return
  }

  // Get or create user
  const user = await getOrCreateUser(telegramId, message.from)
  if (!user) {
    await sendMessage({ chatId, text: 'Something went wrong setting up your account. Try again.' })
    return
  }

  // Handle bot commands
  if (text.startsWith('/')) {
    await handleBotCommand(text, user, chatId)
    return
  }

  // Check for keyword recipe matches before routing to orchestrator
  const keywordRecipe = await checkKeywordRecipes(user.id, text)
  if (keywordRecipe) {
    const { executeRecipe } = await import('@/lib/recipes/execution-agent')
    await executeRecipe(
      {
        id: keywordRecipe.id,
        user_id: keywordRecipe.user_id,
        name: keywordRecipe.name,
        instructions: keywordRecipe.instructions,
        trigger_type: 'keyword',
        notify_on_run: keywordRecipe.notify_on_run,
        run_count: keywordRecipe.run_count,
        fee_amount: keywordRecipe.fee_amount,
        fee_required: keywordRecipe.fee_required,
      },
      { keyword: true, message: text }
    )
    return
  }

  // Build user context
  const ctx = await buildUserContext(user, chatId)

  const userPrefs = (user as unknown as Record<string, unknown>).preferences as Record<string, unknown> | undefined
  const userProvider = userPrefs?.llm_provider as LLMProviderName | undefined

  // Fetch conversation history (summarization uses the user's provider) and
  // recall relevant long-term memory for this message — in parallel.
  const [history, relevantMemory] = await Promise.all([
    fetchConversationHistory(user.id, userProvider),
    recallMemories(user.id, text),
  ])

  // Persist user message
  await persistMessage(user.id, {
    role: 'user',
    content: text,
  }, message.message_id)

  // Add user message to history for this turn
  const messages: ChatMessage[] = [
    ...history,
    { role: 'user', content: text },
  ]

  // Count includes the just-persisted user message; first message = count of 1
  const supabaseForCount = createServerClient()
  const { count: rawCount } = await supabaseForCount
    .from('messages')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', user.id)

  const messageCount = rawCount ?? 0
  const isFirstMessage = messageCount <= 1

  // Build system prompt with personality and context
  const connectedIntegrations = Object.keys(ctx.tokens)
  const activeModel = getActiveProviderInfo({ provider: userProvider })
  const systemPrompt = buildSystemPrompt({
    datetime: new Date().toISOString(),
    timezone: user.timezone ?? 'UTC',
    name: user.name ?? 'there',
    integrations: connectedIntegrations,
    userPreferences: userPrefs ?? undefined,
    relevantMemory,
    isFirstMessage: isFirstMessage && connectedIntegrations.length > 0,
    messageCount: messageCount ?? 0,
    activeModel,
  })

  // Get tools (including recipe tools + user's MCP tools)
  const recipeMod = await getRecipeTools()
  const recipeTools = recipeMod.allRecipeTools
  const { loadMCPToolsForUser } = await import('@/lib/mcp/client')
  const mcpTools = await loadMCPToolsForUser(user.id).catch(() => [])
  const tools = [...getOrchestratorTools(recipeTools), ...mcpTools]

  // Run agent loop with confirmation support
  const { requestConfirmation } = await import('@/lib/orchestrator/confirmation')
  const response = await runAgentLoop(
    systemPrompt,
    messages,
    tools,
    ctx,
    async (intermediateMsg: string) => {
      await sendChatAction(chatId)
      await sendMessage({ chatId, text: intermediateMsg })
    },
    async (toolName: string, toolInput: Record<string, unknown>) => {
      return requestConfirmation(chatId, toolName, toolInput, ctx.userId)
    },
    userProvider
  )

  // Persist assistant response
  await persistMessage(user.id, {
    role: 'assistant',
    content: response,
  })

  // Send response as rapid-fire chunks (human-like texting)
  const { sendRapidFire } = await import('@/lib/telegram/message-splitter')
  await sendRapidFire(chatId, response)

  // Background: extract user preferences every ~10 messages
  if ((messageCount ?? 0) > 0 && (messageCount ?? 0) % 10 === 0) {
    import('@/lib/orchestrator/preference-extractor')
      .then((mod) => mod.extractPreferences(user.id))
      .catch(() => {
        // Non-critical — silently ignore
      })
  }
}

async function handleCallbackQuery(query: TelegramCallbackQuery): Promise<void> {
  const data = query.data ?? ''
  const chatId = query.message?.chat.id

  if (!chatId) {
    await answerCallbackQuery(query.id, 'Something went wrong.')
    return
  }

  if (data.startsWith('confirm:')) {
    const actionId = data.replace('confirm:', '')
    const { resolveConfirmation } = await import('@/lib/orchestrator/confirmation')
    const resolved = await resolveConfirmation(actionId, true)

    if (!resolved) {
      await answerCallbackQuery(query.id, 'This action has expired.')
      return
    }

    await answerCallbackQuery(query.id, '✅')
    if (query.message) {
      await editMessage({
        chatId,
        messageId: query.message.message_id,
        text: `${query.message.text ?? ''}\n\n✅ confirmed`,
      })
    }
    return
  }

  if (data.startsWith('cancel:')) {
    const actionId = data.replace('cancel:', '')
    const { resolveConfirmation } = await import('@/lib/orchestrator/confirmation')
    await resolveConfirmation(actionId, false)
    await answerCallbackQuery(query.id, 'cancelled')

    if (query.message) {
      await editMessage({
        chatId,
        messageId: query.message.message_id,
        text: '❌ cancelled',
      })
    }
    return
  }

  // Recipe activation/cancellation callbacks
  if (data.startsWith('recipe_activate:')) {
    const recipeId = data.replace('recipe_activate:', '')
    const supabase = createServerClient()
    await supabase.from('recipes').update({ enabled: true }).eq('id', recipeId)
    await answerCallbackQuery(query.id, 'Recipe activated!')
    if (query.message) {
      await editMessage({
        chatId,
        messageId: query.message.message_id,
        text: `${query.message.text ?? ''}\n\n✅ Activated!`,
      })
    }
    return
  }

  if (data.startsWith('recipe_cancel:')) {
    const recipeId = data.replace('recipe_cancel:', '')
    const supabase = createServerClient()
    await supabase.from('recipes').delete().eq('id', recipeId)
    await answerCallbackQuery(query.id, 'Recipe cancelled.')
    if (query.message) {
      await editMessage({
        chatId,
        messageId: query.message.message_id,
        text: '❌ Recipe cancelled.',
      })
    }
    return
  }

  if (data.startsWith('recipe_edit:')) {
    const recipeId = data.replace('recipe_edit:', '')
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''
    await answerCallbackQuery(query.id)
    await sendMessage({
      chatId,
      text: `Edit this recipe in The Harbor:\n${appUrl}/dashboard/recipes/${recipeId}/edit`,
    })
    return
  }

  // Quick action buttons
  if (data.startsWith('quick:')) {
    const action = data.replace('quick:', '')
    await answerCallbackQuery(query.id)

    const quickPrompts: Record<string, string> = {
      emails: 'Summarize my inbox — what emails need my attention?',
      calendar: "What's on my calendar today?",
      reminder: 'I need to set a reminder',
      search: 'Search the web for',
      sleep: 'How did I sleep last night?',
      timeline: "What's happening on my Twitter timeline?",
      recipe: 'Help me create a new recipe automation',
    }

    const promptText = quickPrompts[action]
    if (promptText) {
      // Get the user from telegram ID
      const fromId = query.from.id
      const syntheticMessage: TelegramMessage = {
        message_id: 0,
        chat: { id: chatId, type: 'private' },
        date: Math.floor(Date.now() / 1000),
        text: promptText,
        from: { id: fromId, is_bot: false, first_name: query.from.first_name ?? '' },
      }
      await handleMessage(syntheticMessage)
    }
    return
  }

  await answerCallbackQuery(query.id)
}

async function handleBotCommand(text: string, user: DbUser, chatId: number): Promise<void> {
  const command = text.split(' ')[0].replace('@heydeckhandbot', '')

  switch (command) {
    case '/start': {
      const { buildMagicLink } = await import('@/lib/auth/magic-link')
      const magicLink = buildMagicLink({
        telegramId: user.telegram_id,
        name: user.name ?? 'there',
        username: user.telegram_username,
        ts: Date.now(),
      })
      const firstName = (user.name ?? '').split(' ')[0].toLowerCase()
      await sendMessage({
        chatId,
        text: `hey${firstName ? ` ${firstName}` : ''}! i'm dock ⚓\n\nconnect your stuff and i'll take it from there:\n${magicLink}`,
        replyMarkup: {
          inline_keyboard: [
            [
              { text: '📧 Check emails', callback_data: 'quick:emails' },
              { text: '📅 My day', callback_data: 'quick:calendar' },
            ],
            [
              { text: '⏰ Set reminder', callback_data: 'quick:reminder' },
              { text: '🔍 Search web', callback_data: 'quick:search' },
            ],
          ],
        },
      })
      break
    }

    case '/status': {
      const ctx = await buildUserContext(user, chatId)
      const connected = Object.keys(ctx.tokens)
      const statusText = connected.length > 0
        ? `Connected integrations: ${connected.join(', ')}`
        : 'No integrations connected yet. Visit The Harbor to set up.'
      await sendMessage({ chatId, text: statusText })
      break
    }

    case '/reminders': {
      // Trigger the orchestrator with a synthetic message
      const syntheticMessage: TelegramMessage = {
        message_id: 0,
        chat: { id: chatId, type: 'private' },
        date: Math.floor(Date.now() / 1000),
        text: 'List my reminders',
        from: { id: user.telegram_id, is_bot: false, first_name: user.name ?? '' },
      }
      await handleMessage(syntheticMessage)
      break
    }

    case '/briefing': {
      const syntheticMessage: TelegramMessage = {
        message_id: 0,
        chat: { id: chatId, type: 'private' },
        date: Math.floor(Date.now() / 1000),
        text: "Give me today's briefing — calendar and unread emails",
        from: { id: user.telegram_id, is_bot: false, first_name: user.name ?? '' },
      }
      await handleMessage(syntheticMessage)
      break
    }

    case '/recipes': {
      const syntheticMessage: TelegramMessage = {
        message_id: 0,
        chat: { id: chatId, type: 'private' },
        date: Math.floor(Date.now() / 1000),
        text: 'List my recipes',
        from: { id: user.telegram_id, is_bot: false, first_name: user.name ?? '' },
      }
      await handleMessage(syntheticMessage)
      break
    }

    case '/quiet': {
      const hasQuietHours = user.quiet_hours_start && user.quiet_hours_end
      if (hasQuietHours) {
        const supabase = createServerClient()
        await supabase
          .from('users')
          .update({ quiet_hours_start: null, quiet_hours_end: null })
          .eq('id', user.id)
        await sendMessage({ chatId, text: 'Quiet hours disabled. I may message you anytime now.' })
      } else {
        const supabase = createServerClient()
        await supabase
          .from('users')
          .update({ quiet_hours_start: '22:00', quiet_hours_end: '08:00' })
          .eq('id', user.id)
        await sendMessage({ chatId, text: 'Quiet hours enabled: 10 PM – 8 AM. Adjust in The Harbor if needed.' })
      }
      break
    }

    case '/help': {
      await sendMessage({
        chatId,
        text: `here's what i can do:\n\n📧 email — search, read, draft, send, reply, archive\n📅 calendar — view events, create, update, delete, find free time\n🐙 github — repos, issues, PRs, notifications\n📝 notion — search, read, create, update pages & databases\n🔐 wallet — check balances, send crypto, sign messages\n⏰ reminders — set, list, cancel\n⚡ recipes — automated workflows on triggers\n🔍 web — search the internet, read any page\n💤 health — sleep, recovery, activity (Oura/WHOOP)\n🐦 twitter — timeline, search, bookmarks\n🛒 x402 — paid third-party APIs\n\ntry one of these to get started:`,
        replyMarkup: {
          inline_keyboard: [
            [
              { text: '📧 Summarize inbox', callback_data: 'quick:emails' },
              { text: '📅 Today\'s schedule', callback_data: 'quick:calendar' },
            ],
            [
              { text: '💤 How did I sleep?', callback_data: 'quick:sleep' },
              { text: '🐦 My timeline', callback_data: 'quick:timeline' },
            ],
            [
              { text: '⚡ Create a recipe', callback_data: 'quick:recipe' },
              { text: '🔍 Search the web', callback_data: 'quick:search' },
            ],
          ],
        },
      })
      break
    }

    default:
      await sendMessage({ chatId, text: "I don't recognize that command. Try /help for a list." })
  }
}

// --- Helpers ---

interface DbUser {
  id: string
  telegram_id: number
  telegram_username: string | null
  name: string | null
  timezone: string
  quiet_hours_start: string | null
  quiet_hours_end: string | null
  daily_briefing: boolean
  wallet_address: string | null
  wallet_chain: string
}

async function getOrCreateUser(
  telegramId: number,
  from?: { first_name: string; last_name?: string; username?: string }
): Promise<DbUser | null> {
  const supabase = createServerClient()

  const { data: existing } = await supabase
    .from('users')
    .select('*')
    .eq('telegram_id', telegramId)
    .single()

  if (existing) {
    return existing as DbUser
  }

  const name = from
    ? [from.first_name, from.last_name].filter(Boolean).join(' ')
    : null

  const { data: created, error } = await supabase
    .from('users')
    .insert({
      telegram_id: telegramId,
      telegram_username: from?.username ?? null,
      name,
    })
    .select('*')
    .single()

  if (error || !created) {
    return null
  }

  return created as DbUser
}

async function getUserById(userId: string): Promise<DbUser> {
  const supabase = createServerClient()
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('id', userId)
    .single()

  if (error || !data) {
    throw new Error(`User not found: ${userId}`)
  }

  return data as DbUser
}

async function buildUserContext(user: DbUser, chatId: number): Promise<UserContext> {
  const tokens = await getDecryptedTokens(user.id)

  return {
    userId: user.id,
    telegramId: user.telegram_id,
    telegramChatId: chatId,
    name: user.name ?? '',
    timezone: user.timezone ?? 'UTC',
    tokens,
  }
}

async function getDecryptedTokens(userId: string): Promise<Record<string, DecryptedTokens>> {
  const supabase = createServerClient()

  const { data, error } = await supabase
    .from('oauth_tokens')
    .select('provider, access_token, refresh_token, expires_at')
    .eq('user_id', userId)

  if (error || !data) {
    return {}
  }

  const tokens: Record<string, DecryptedTokens> = {}

  for (const row of data) {
    try {
      tokens[row.provider as string] = {
        accessToken: decryptTokenFromDb(row.access_token as string),
        refreshToken: row.refresh_token ? decryptTokenFromDb(row.refresh_token as string) : null,
        expiresAt: (row.expires_at as string) ?? null,
      }
    } catch {
      // Skip tokens that can't be decrypted — likely corrupted
    }
  }

  return tokens
}

async function sendLongMessage(chatId: number, text: string): Promise<void> {
  const MAX_LENGTH = 4096

  if (text.length <= MAX_LENGTH) {
    await sendMessage({ chatId, text })
    return
  }

  // Split at paragraph boundaries
  const paragraphs = text.split('\n\n')
  let current = ''

  for (const para of paragraphs) {
    if (current.length + para.length + 2 > MAX_LENGTH) {
      if (current) {
        await sendMessage({ chatId, text: current.trim() })
      }
      current = para
    } else {
      current = current ? `${current}\n\n${para}` : para
    }
  }

  if (current.trim()) {
    await sendMessage({ chatId, text: current.trim() })
  }
}

// --- Keyword recipe matching ---

interface KeywordRecipeMatch {
  id: string
  user_id: string
  name: string
  instructions: string
  notify_on_run: boolean
  run_count: number
  fee_amount: number
  fee_required: boolean
}

async function checkKeywordRecipes(
  userId: string,
  message: string
): Promise<KeywordRecipeMatch | null> {
  const { matchesKeywordTrigger } = await import('@/lib/recipes/trigger-evaluator')
  const supabase = createServerClient()

  const { data: recipes } = await supabase
    .from('recipes')
    .select('id, user_id, name, instructions, trigger_config, notify_on_run, run_count, fee_amount, fee_required')
    .eq('user_id', userId)
    .eq('trigger_type', 'keyword')
    .eq('enabled', true)
    .order('created_at', { ascending: true })

  if (!recipes || recipes.length === 0) return null

  for (const recipe of recipes) {
    const config = recipe.trigger_config as {
      phrase: string
      match_type: 'exact' | 'contains' | 'starts_with'
      case_sensitive: boolean
    }

    if (matchesKeywordTrigger(message, config)) {
      return {
        id: recipe.id as string,
        user_id: recipe.user_id as string,
        name: recipe.name as string,
        instructions: recipe.instructions as string,
        notify_on_run: recipe.notify_on_run as boolean,
        run_count: (recipe.run_count as number) ?? 0,
        fee_amount: (recipe.fee_amount as number) ?? 0,
        fee_required: (recipe.fee_required as boolean) ?? false,
      }
    }
  }

  return null
}

// Export for use by recipe execution agent and cron jobs
export { getOrCreateUser, getUserById, buildUserContext, getDecryptedTokens, sendLongMessage }
