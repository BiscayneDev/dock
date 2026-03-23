import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { runAgentLoop } from '@/lib/llm/agent-loop'
import { integrationTools } from '@/lib/tools/index'
import { getDecryptedTokens } from '@/lib/orchestrator/index'
import { isInQuietHours } from '@/lib/time-utils'
import type { UserContext } from '@/lib/llm/types'

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createServerClient()

  // Get users with daily briefing enabled
  const { data: users, error } = await supabase
    .from('users')
    .select('id, telegram_id, name, timezone, quiet_hours_start, quiet_hours_end')
    .eq('daily_briefing', true)

  if (error || !users || users.length === 0) {
    return NextResponse.json({ sent: 0 })
  }

  let sentCount = 0

  for (const user of users) {
    const timezone = (user.timezone as string) ?? 'UTC'

    // Check if current hour in user's timezone is 8 AM
    const now = new Date()
    const formatter = new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      hour12: false,
      timeZone: timezone,
    })
    const currentHour = parseInt(formatter.format(now), 10)

    if (currentHour !== 8) continue

    // Respect quiet hours
    if (isInQuietHours(
      user.quiet_hours_start as string | null,
      user.quiet_hours_end as string | null,
      timezone
    )) continue

    // Check if already sent today
    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)

    const { count } = await supabase
      .from('messages')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('role', 'assistant')
      .gte('created_at', todayStart.toISOString())
      .like('content', '%Daily Briefing%')

    if ((count ?? 0) > 0) continue

    try {
      const tokens = await getDecryptedTokens(user.id as string)
      const ctx: UserContext = {
        userId: user.id as string,
        telegramId: user.telegram_id as number,
        telegramChatId: user.telegram_id as number,
        name: (user.name as string) ?? '',
        timezone,
        tokens,
      }

      // Only run briefing if Google is connected
      if (!tokens.google) continue

      const userName = ((user.name as string) ?? '').split(' ')[0].toLowerCase()
      const briefingPrompt = `you're dock, sending ${userName || 'the user'} their morning snapshot.
current datetime: ${now.toISOString()}
user timezone: ${timezone}

check their calendar for today and summarize any unread emails from the last 12 hours.
write it like you're texting a friend their day. casual, no headers, just the highlights.
keep it short — a few sentences per section. use lowercase.
start with something like "morning ${userName}" or "hey, here's your day"`

      const briefing = await runAgentLoop(
        briefingPrompt,
        [{ role: 'user', content: 'morning briefing' }],
        integrationTools,
        ctx
      )

      const { sendRapidFire } = await import('@/lib/telegram/message-splitter')
      await sendRapidFire(user.telegram_id as number, briefing)

      // Persist as a message for history
      await supabase.from('messages').insert({
        user_id: user.id,
        role: 'assistant',
        content: briefing,
      })

      sentCount++
    } catch {
      // Failed for this user — continue with others
    }
  }

  return NextResponse.json({ sent: sentCount })
}
