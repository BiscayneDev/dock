const TELEGRAM_API = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`

// MarkdownV2 requires escaping these characters
const MARKDOWN_V2_ESCAPE_CHARS = ['_', '*', '[', ']', '(', ')', '~', '`', '>', '#', '+', '-', '=', '|', '{', '}', '.', '!']

export function escapeMarkdownV2(text: string): string {
  let escaped = text
  for (const char of MARKDOWN_V2_ESCAPE_CHARS) {
    escaped = escaped.replaceAll(char, `\\${char}`)
  }
  return escaped
}

interface SendMessageOptions {
  chatId: number
  text: string
  parseMode?: 'MarkdownV2' | 'HTML'
  replyMarkup?: InlineKeyboardMarkup
  replyToMessageId?: number
}

interface InlineKeyboardMarkup {
  inline_keyboard: InlineKeyboardButton[][]
}

interface InlineKeyboardButton {
  text: string
  callback_data?: string
  url?: string
}

export type { InlineKeyboardMarkup, InlineKeyboardButton }

interface TelegramApiResponse {
  ok: boolean
  result?: unknown
  description?: string
}

async function callTelegramApi(method: string, body: Record<string, unknown>): Promise<TelegramApiResponse> {
  const response = await fetch(`${TELEGRAM_API}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  const data = (await response.json()) as TelegramApiResponse

  if (!data.ok) {
    throw new Error(`Telegram API error [${method}]: ${data.description ?? 'Unknown error'}`)
  }

  return data
}

export async function sendMessage(options: SendMessageOptions): Promise<TelegramApiResponse> {
  const body: Record<string, unknown> = {
    chat_id: options.chatId,
    text: options.text,
  }

  if (options.parseMode) {
    body.parse_mode = options.parseMode
  }
  if (options.replyMarkup) {
    body.reply_markup = options.replyMarkup
  }
  if (options.replyToMessageId) {
    body.reply_to_message_id = options.replyToMessageId
  }

  return callTelegramApi('sendMessage', body)
}

export async function sendChatAction(chatId: number, action: string = 'typing'): Promise<void> {
  await callTelegramApi('sendChatAction', {
    chat_id: chatId,
    action,
  })
}

interface EditMessageOptions {
  chatId: number
  messageId: number
  text: string
  parseMode?: 'MarkdownV2' | 'HTML'
  replyMarkup?: InlineKeyboardMarkup
}

export async function editMessage(options: EditMessageOptions): Promise<TelegramApiResponse> {
  const body: Record<string, unknown> = {
    chat_id: options.chatId,
    message_id: options.messageId,
    text: options.text,
  }

  if (options.parseMode) {
    body.parse_mode = options.parseMode
  }
  if (options.replyMarkup) {
    body.reply_markup = options.replyMarkup
  }

  return callTelegramApi('editMessageText', body)
}

export async function answerCallbackQuery(
  callbackQueryId: string,
  text?: string,
  showAlert?: boolean
): Promise<void> {
  const body: Record<string, unknown> = {
    callback_query_id: callbackQueryId,
  }

  if (text) {
    body.text = text
  }
  if (showAlert !== undefined) {
    body.show_alert = showAlert
  }

  await callTelegramApi('answerCallbackQuery', body)
}

export async function setWebhook(url: string, secretToken: string): Promise<TelegramApiResponse> {
  return callTelegramApi('setWebhook', {
    url,
    secret_token: secretToken,
    allowed_updates: ['message', 'callback_query', 'my_chat_member'],
  })
}
