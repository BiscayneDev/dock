import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getDecryptedTokens } from '@/lib/orchestrator/index'
import { integrationTools } from '@/lib/tools/index'
import { classifyEmail } from '@/lib/email/classifier'
import { sendMessage } from '@/lib/telegram/client'
import { logger } from '@/lib/logger'
import type { UserContext } from '@/lib/llm/types'

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createServerClient()

  // Get users with email monitoring enabled and Google connected
  const { data: users, error } = await supabase
    .from('users')
    .select('id, telegram_id, name, timezone, email_last_checked_at, quiet_hours_start, quiet_hours_end')
    .eq('email_monitor_enabled', true)

  if (error || !users || users.length === 0) {
    return NextResponse.json({ checked: 0, notified: 0 })
  }

  let notifiedCount = 0

  for (const user of users) {
    try {
      const tokens = await getDecryptedTokens(user.id as string)
      if (!tokens.google) continue

      const ctx: UserContext = {
        userId: user.id as string,
        telegramId: user.telegram_id as number,
        telegramChatId: user.telegram_id as number,
        name: (user.name as string) ?? '',
        timezone: (user.timezone as string) ?? 'UTC',
        tokens,
      }

      // Search for new emails since last check
      const lastChecked = (user.email_last_checked_at as string)
        ?? new Date(Date.now() - 2 * 60 * 1000).toISOString()
      const afterEpoch = Math.floor(new Date(lastChecked).getTime() / 1000)

      const gmailSearch = integrationTools.find((t) => t.name === 'gmail_search')
      if (!gmailSearch) continue

      const result = await gmailSearch.execute(
        { query: `after:${afterEpoch}`, maxResults: 15 },
        ctx
      )

      if (!result.success || !result.data) {
        // Update last_checked even on failure to avoid re-processing
        await supabase
          .from('users')
          .update({ email_last_checked_at: new Date().toISOString() })
          .eq('id', user.id)
        continue
      }

      const data = result.data as {
        messages?: Array<{
          id: string
          from: string
          subject: string
          snippet: string
          date: string
        }>
      }
      const emails = data.messages ?? []

      if (emails.length === 0) {
        await supabase
          .from('users')
          .update({ email_last_checked_at: new Date().toISOString() })
          .eq('id', user.id)
        continue
      }

      // Check quiet hours
      if (isInQuietHours(
        user.quiet_hours_start as string | null,
        user.quiet_hours_end as string | null,
        (user.timezone as string) ?? 'UTC'
      )) {
        // Still update last_checked so we don't re-process
        await supabase
          .from('users')
          .update({ email_last_checked_at: new Date().toISOString() })
          .eq('id', user.id)
        continue
      }

      // Classify each email and notify for urgent/high or OTPs
      for (const email of emails) {
        const classification = await classifyEmail({
          from: email.from,
          subject: email.subject,
          snippet: email.snippet,
        })

        const userName = (user.name as string) ?? ''
        const fromShort = email.from.split('<')[0].trim() || email.from

        if (classification.isOTP) {
          // Try to extract the actual code from the snippet
          const codeMatch = (email.snippet as string).match(/\b(\d{4,8})\b/)
          const codeStr = codeMatch ? ` — code: ${codeMatch[1]}` : ''
          await sendMessage({
            chatId: user.telegram_id as number,
            text: `hey${userName ? ` ${userName.split(' ')[0].toLowerCase()}` : ''}, got a verification code from ${fromShort}${codeStr}`,
          })
          notifiedCount++
        } else if (classification.urgency === 'critical') {
          await sendMessage({
            chatId: user.telegram_id as number,
            text: `🚨 ${userName ? `${userName.split(' ')[0].toLowerCase()}, ` : ''}${classification.summary}. probably want to look at this`,
          })
          notifiedCount++
        } else if (classification.urgency === 'high') {
          await sendMessage({
            chatId: user.telegram_id as number,
            text: `heads up — ${fromShort} just emailed about "${email.subject}". looks important`,
          })
          notifiedCount++
        }
      }

      await supabase
        .from('users')
        .update({ email_last_checked_at: new Date().toISOString() })
        .eq('id', user.id)
    } catch (err) {
      logger.error('Email monitor failed for user', {
        userId: user.id as string,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return NextResponse.json({ checked: users.length, notified: notifiedCount })
}

function isInQuietHours(start: string | null, end: string | null, timezone: string): boolean {
  if (!start || !end) return false
  const now = new Date()
  const formatter = new Intl.DateTimeFormat('en-US', {
    hour: '2-digit', minute: '2-digit', hour12: false, timeZone: timezone,
  })
  const currentTime = formatter.format(now)
  const [currentHour, currentMin] = currentTime.split(':').map(Number)
  const currentMinutes = currentHour * 60 + currentMin
  const [startHour, startMin] = start.split(':').map(Number)
  const startMinutes = startHour * 60 + startMin
  const [endHour, endMin] = end.split(':').map(Number)
  const endMinutes = endHour * 60 + endMin
  if (startMinutes > endMinutes) {
    return currentMinutes >= startMinutes || currentMinutes < endMinutes
  }
  return currentMinutes >= startMinutes && currentMinutes < endMinutes
}
