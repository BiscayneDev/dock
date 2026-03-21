import { NextRequest, NextResponse } from 'next/server'
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

  // Process update asynchronously to respond within 5s
  const processing = handleTelegramUpdate(parsed.data).catch((err) => {
    const message = err instanceof Error ? err.message : String(err)
    logger.error('Webhook processing error', { error: message })
  })

  // If running on Vercel with waitUntil support, use it
  const waitUntil = (request as unknown as { waitUntil?: (p: Promise<unknown>) => void }).waitUntil
  if (waitUntil) {
    waitUntil(processing)
  } else {
    await processing
  }

  return NextResponse.json({ ok: true })
}
