import { NextResponse } from 'next/server'
import { setWebhook } from '@/lib/telegram/client'

export async function GET(): Promise<NextResponse> {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL
  const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET

  if (!appUrl) {
    return NextResponse.json(
      { error: 'NEXT_PUBLIC_APP_URL is not set' },
      { status: 500 }
    )
  }

  if (!webhookSecret) {
    return NextResponse.json(
      { error: 'TELEGRAM_WEBHOOK_SECRET is not set' },
      { status: 500 }
    )
  }

  const webhookUrl = `${appUrl}/api/telegram/webhook`

  try {
    const result = await setWebhook(webhookUrl, webhookSecret)
    return NextResponse.json({
      success: true,
      webhookUrl,
      result,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json(
      { error: `Failed to set webhook: ${message}` },
      { status: 500 }
    )
  }
}
