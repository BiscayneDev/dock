import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { sendMessage } from '@/lib/telegram/client'
import { getDecryptedTokens } from '@/lib/orchestrator/index'
import { google } from 'googleapis'
import { getAuthedClient } from '@/lib/integrations/google'

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createServerClient()
  const now = new Date()
  let alertsSent = 0

  // Get all users (limit to avoid timeout)
  const { data: users } = await supabase
    .from('users')
    .select('id, telegram_id, name, timezone, quiet_hours_start, quiet_hours_end')
    .limit(100)

  if (!users || users.length === 0) {
    return NextResponse.json({ alerts: 0 })
  }

  for (const user of users) {
    const timezone = (user.timezone as string) ?? 'UTC'

    // Skip if in quiet hours
    if (isInQuietHours(user.quiet_hours_start as string | null, user.quiet_hours_end as string | null, timezone)) {
      continue
    }

    try {
      const tokens = await getDecryptedTokens(user.id as string)

      // --- Calendar alerts: events starting in ~15 minutes ---
      if (tokens.google) {
        const alerts = await checkUpcomingEvents(
          user.id as string,
          user.telegram_id as number,
          user.name as string | null,
          tokens.google,
          timezone,
          supabase
        )
        alertsSent += alerts
      }

      // --- Recipe failure alerts ---
      const failAlerts = await checkRecipeFailures(
        user.id as string,
        user.telegram_id as number,
        supabase
      )
      alertsSent += failAlerts

    } catch {
      // Skip user on error
    }
  }

  return NextResponse.json({ alerts: alertsSent })
}

async function checkUpcomingEvents(
  userId: string,
  telegramId: number,
  name: string | null,
  googleTokens: { accessToken: string; refreshToken: string | null; expiresAt: string | null },
  timezone: string,
  supabase: ReturnType<typeof createServerClient>
): Promise<number> {
  try {
    const auth = await getAuthedClient(googleTokens, userId)
    const calendar = google.calendar({ version: 'v3', auth })

    const now = new Date()
    const soon = new Date(now.getTime() + 20 * 60 * 1000) // 20 min from now
    const justAhead = new Date(now.getTime() + 10 * 60 * 1000) // 10 min from now

    const { data } = await calendar.events.list({
      calendarId: 'primary',
      timeMin: justAhead.toISOString(),
      timeMax: soon.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: 5,
    })

    const events = data.items ?? []
    let sent = 0

    for (const event of events) {
      if (!event.summary || !event.id) continue

      // Check if we already alerted for this event
      const { count } = await supabase
        .from('messages')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('role', 'assistant')
        .gte('created_at', new Date(now.getTime() - 60 * 60 * 1000).toISOString())
        .like('content', `%${event.summary}%`)

      if ((count ?? 0) > 0) continue

      const startTime = event.start?.dateTime
        ? new Date(event.start.dateTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: timezone })
        : 'soon'

      const location = event.location ? `\n📍 ${event.location}` : ''
      const meetLink = event.hangoutLink ? `\n🔗 ${event.hangoutLink}` : ''

      await sendMessage({
        chatId: telegramId,
        text: `heads up — *${event.summary}* starts at ${startTime}${location}${meetLink}`,
      })

      // Log it so we don't re-alert
      await supabase.from('messages').insert({
        user_id: userId,
        role: 'assistant',
        content: `[smart-alert] upcoming: ${event.summary} at ${startTime}`,
      })

      sent++
    }

    return sent
  } catch {
    return 0
  }
}

async function checkRecipeFailures(
  userId: string,
  telegramId: number,
  supabase: ReturnType<typeof createServerClient>
): Promise<number> {
  const fifteenMinAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString()

  const { data: failures } = await supabase
    .from('recipe_runs')
    .select('id, recipe_id, error, recipes!inner(name, notify_on_run)')
    .eq('user_id', userId)
    .eq('status', 'failed')
    .gte('triggered_at', fifteenMinAgo)
    .limit(5)

  if (!failures || failures.length === 0) return 0

  let sent = 0
  for (const fail of failures) {
    const recipe = fail.recipes as unknown as { name: string; notify_on_run: boolean }
    if (!recipe?.notify_on_run) continue

    // Check we haven't already notified about this run
    const { count } = await supabase
      .from('messages')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .like('content', `%${fail.id}%`)

    if ((count ?? 0) > 0) continue

    await sendMessage({
      chatId: telegramId,
      text: `recipe "${recipe.name}" just failed — ${(fail.error as string)?.slice(0, 100) ?? 'unknown error'}`,
    })

    await supabase.from('messages').insert({
      user_id: userId,
      role: 'assistant',
      content: `[smart-alert] recipe failure: ${recipe.name} (run ${fail.id})`,
    })

    sent++
  }

  return sent
}

function isInQuietHours(start: string | null, end: string | null, timezone: string): boolean {
  if (!start || !end) return false
  const now = new Date()
  const formatter = new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: timezone })
  const currentTime = formatter.format(now)
  const [currentHour, currentMin] = currentTime.split(':').map(Number)
  const currentMinutes = currentHour * 60 + currentMin
  const [startHour, startMin] = start.split(':').map(Number)
  const startMinutes = startHour * 60 + startMin
  const [endHour, endMin] = end.split(':').map(Number)
  const endMinutes = endHour * 60 + endMin
  if (startMinutes > endMinutes) return currentMinutes >= startMinutes || currentMinutes < endMinutes
  return currentMinutes >= startMinutes && currentMinutes < endMinutes
}
