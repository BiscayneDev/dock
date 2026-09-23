/**
 * Kill switch for the Telegram product path (bot webhook + its crons).
 *
 * Off unless TELEGRAM_ENABLED=true. Disabled routes return 200 with
 * {skipped} so Vercel crons and Telegram's webhook retries stay quiet. To
 * bring Telegram back, set TELEGRAM_ENABLED=true in Vercel and redeploy; no
 * code was removed.
 */
import { NextResponse } from 'next/server'

export function telegramEnabled(): boolean {
    return process.env.TELEGRAM_ENABLED === 'true'
}

export function telegramDisabledResponse(): NextResponse {
    return NextResponse.json({ skipped: 'telegram disabled (TELEGRAM_ENABLED != true)' })
}
