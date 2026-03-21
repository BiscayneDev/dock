import { NextRequest, NextResponse } from 'next/server'
import { after } from 'next/server'
import { TelegramUpdateSchema } from '@/lib/telegram/types'
import { handleTelegramUpdate } from '@/lib/orchestrator/index'
import { isRateLimited } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'

const MAX_REQUESTS_PER_MINUTE = 20
const WINDOW_MS = 60_000

export async function POST(request: NextRequest): Promise<NextResponse> {
  // Verify webhook secret
  const secretToken = request.headers.get('x-telegram-bot-api-secret-token')
  if (secretToken !== process.env.TELEGRAM_WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = TelegramUpdateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid update' }, { status: 400 })
  }

  // Rate limit by telegram user ID
  const telegramId =
    parsed.data.message?.from?.id ??
    parsed.data.callback_query?.from.id ??
    parsed.data.my_chat_member?.from.id

  if (telegramId && isRateLimited(`tg:${telegramId}`, MAX_REQUESTS_PER_MINUTE, WINDOW_MS)) {
    return NextResponse.json({ error: 'Rate limited' }, { status: 429 })
  }

  // Use Next.js after() to process in the background after response is sent
  const update = parsed.data
  after(async () => {
    try {
      await handleTelegramUpdate(update)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      logger.error('Webhook processing error', { error: message })

      // Try to notify the user of the error
      const chatId = update.message?.chat.id ?? update.callback_query?.message?.chat.id
      if (chatId) {
        try {
          const { sendMessage } = await import('@/lib/telegram/client')
          await sendMessage({ chatId, text: 'something went wrong on my end. try again in a sec.' })
        } catch {
          // Can't even send error message — silently fail
        }
      }
    }
  })

  return NextResponse.json({ ok: true })
}
