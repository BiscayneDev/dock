import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { sendMessage } from '@/lib/telegram/client'
import { isInQuietHours, getCurrentHour } from '@/lib/time-utils'

// Engagement events sent at specific days after signup
const ENGAGEMENT_SCHEDULE: Array<{
  event: string
  daysAfterSignup: number
  buildMessage: (name: string, integrations: string[]) => string
}> = [
  {
    event: 'day_1_briefing_demo',
    daysAfterSignup: 1,
    buildMessage: (name) =>
      `morning ${name || 'captain'} — just showing you what a daily briefing looks like. if you want this every day, tell me "set up a daily briefing" or toggle it on in the harbor settings.`,
  },
  {
    event: 'day_3_recipes_nudge',
    daysAfterSignup: 3,
    buildMessage: (name, integrations) => {
      const suggestions: string[] = []
      if (integrations.includes('google')) suggestions.push('"summarize my inbox every morning"')
      if (integrations.includes('github')) suggestions.push('"alert me when a PR needs review"')
      if (integrations.includes('notion')) suggestions.push('"create a notion page for every new github issue"')
      if (suggestions.length === 0) suggestions.push('"remind me to check email every day at 9am"')
      const top = suggestions.slice(0, 2).join(' or ')
      return `hey ${name || 'there'} — you haven't tried recipes yet. recipes are automations that run on their own. try saying ${top} and i'll set it up for you.`
    },
  },
  {
    event: 'day_5_weekly_recap',
    daysAfterSignup: 5,
    buildMessage: (name) =>
      `quick check-in ${name || 'captain'} — been a few days. anything you wish i could handle automatically? just describe it and i'll make it a recipe. could be email sorting, calendar prep, github notifications, whatever.`,
  },
  {
    event: 'day_7_briefing_cta',
    daysAfterSignup: 7,
    buildMessage: (name) =>
      `one week in — hope dock's been useful. if you want a daily snapshot of your calendar and emails every morning, just say "enable daily briefing" and i'll take care of the rest. no setup needed.`,
  },
]

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createServerClient()
  const now = new Date()
  let sent = 0

  // Get users created within the last 8 days (engagement window)
  const eightDaysAgo = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000).toISOString()
  const { data: users } = await supabase
    .from('users')
    .select('id, telegram_id, name, timezone, quiet_hours_start, quiet_hours_end, created_at')
    .gte('created_at', eightDaysAgo)
    .limit(100)

  if (!users || users.length === 0) {
    return NextResponse.json({ sent: 0 })
  }

  for (const user of users) {
    const timezone = (user.timezone as string) ?? 'UTC'

    // Skip if in quiet hours
    if (isInQuietHours(user.quiet_hours_start as string | null, user.quiet_hours_end as string | null, timezone)) {
      continue
    }

    // Only send during reasonable hours (8am-8pm in user's timezone)
    const hour = getCurrentHour(timezone)
    if (hour < 8 || hour >= 20) continue

    const daysSinceSignup = Math.floor((now.getTime() - new Date(user.created_at as string).getTime()) / (24 * 60 * 60 * 1000))

    // Get already-sent events for this user
    const { data: sentEvents } = await supabase
      .from('engagement_events')
      .select('event_type')
      .eq('user_id', user.id)

    const sentSet = new Set((sentEvents ?? []).map((e) => e.event_type as string))

    // Get connected integrations
    const { data: tokens } = await supabase
      .from('oauth_tokens')
      .select('provider')
      .eq('user_id', user.id)

    const integrations = (tokens ?? []).map((t) => t.provider as string)

    for (const step of ENGAGEMENT_SCHEDULE) {
      if (daysSinceSignup < step.daysAfterSignup) continue
      if (sentSet.has(step.event)) continue

      try {
        const name = ((user.name as string) ?? '').split(' ')[0].toLowerCase()
        const message = step.buildMessage(name, integrations)

        await sendMessage({
          chatId: user.telegram_id as number,
          text: message,
        })

        await supabase.from('engagement_events').insert({
          user_id: user.id,
          event_type: step.event,
        })

        sent++
        break // Only send one engagement message per user per cycle
      } catch {
        // Skip on error
      }
    }
  }

  return NextResponse.json({ sent })
}
