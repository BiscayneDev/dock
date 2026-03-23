import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { sendMessage } from '@/lib/telegram/client'
import { isInQuietHours } from '@/lib/time-utils'

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createServerClient()

  // Get all due reminders
  const { data: reminders, error } = await supabase
    .from('reminders')
    .select('id, user_id, message, fire_at')
    .eq('fired', false)
    .lte('fire_at', new Date().toISOString())
    .limit(100)

  if (error || !reminders || reminders.length === 0) {
    return NextResponse.json({ fired: 0 })
  }

  // Get users for these reminders
  const userIds = [...new Set(reminders.map((r) => r.user_id))]
  const { data: users } = await supabase
    .from('users')
    .select('id, telegram_id, quiet_hours_start, quiet_hours_end, timezone')
    .in('id', userIds)

  const userMap = new Map(
    (users ?? []).map((u) => [u.id as string, u])
  )

  let firedCount = 0

  for (const reminder of reminders) {
    const user = userMap.get(reminder.user_id as string)
    if (!user) continue

    // Check quiet hours
    if (isInQuietHours(user.quiet_hours_start as string | null, user.quiet_hours_end as string | null, (user.timezone as string) ?? 'UTC')) {
      // Defer to after quiet hours
      continue
    }

    try {
      await sendMessage({
        chatId: user.telegram_id as number,
        text: `⏰ Reminder: ${reminder.message as string}`,
      })

      await supabase
        .from('reminders')
        .update({ fired: true })
        .eq('id', reminder.id)

      firedCount++
    } catch {
      // Failed to send — will retry next cron cycle
    }
  }

  return NextResponse.json({ fired: firedCount })
}
