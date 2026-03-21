import { CronExpressionParser } from 'cron-parser'
import { getLLMProvider } from '@/lib/llm/index'

export function isScheduleDue(
  cron: string,
  timezone: string,
  lastRunAt: string | null
): boolean {
  try {
    const expression = CronExpressionParser.parse(cron, {
      tz: timezone,
      currentDate: new Date(),
    })

    const prevFiring = expression.prev().toDate()
    const now = new Date()

    // Check if the previous firing time is within the last 60 seconds
    // and hasn't already been run
    const sixtySecondsAgo = new Date(now.getTime() - 60_000)
    if (prevFiring < sixtySecondsAgo) {
      return false
    }

    if (lastRunAt) {
      const lastRun = new Date(lastRunAt)
      // Don't fire if we already ran within this minute
      if (prevFiring.getTime() - lastRun.getTime() < 60_000) {
        return false
      }
    }

    return true
  } catch {
    return false
  }
}

export function getNextFiring(cron: string, timezone: string): Date | null {
  try {
    const expression = CronExpressionParser.parse(cron, {
      tz: timezone,
      currentDate: new Date(),
    })
    return expression.next().toDate()
  } catch {
    return null
  }
}

export function describeCron(cron: string): string {
  const parts = cron.split(' ')
  if (parts.length !== 5) return cron

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts

  const dayNames: Record<string, string> = {
    '0': 'Sunday', '1': 'Monday', '2': 'Tuesday', '3': 'Wednesday',
    '4': 'Thursday', '5': 'Friday', '6': 'Saturday', '7': 'Sunday',
  }

  let description = ''

  // Time
  if (hour !== '*' && minute !== '*') {
    const h = parseInt(hour, 10)
    const m = parseInt(minute, 10)
    const ampm = h >= 12 ? 'PM' : 'AM'
    const displayHour = h === 0 ? 12 : h > 12 ? h - 12 : h
    description += `${displayHour}:${m.toString().padStart(2, '0')} ${ampm}`
  } else if (minute.startsWith('*/')) {
    description += `every ${minute.replace('*/', '')} minutes`
  } else if (hour === '*' && minute === '0') {
    description += 'every hour'
  }

  // Days
  if (dayOfWeek === '1-5') {
    description = `Every weekday at ${description}`
  } else if (dayOfWeek === '*' && dayOfMonth === '*' && month === '*') {
    description = `Every day at ${description}`
  } else if (dayOfWeek !== '*') {
    const days = dayOfWeek.split(',').map((d) => dayNames[d] ?? d).join(', ')
    description = `Every ${days} at ${description}`
  } else {
    description = `At ${description}`
  }

  return description
}

export async function naturalLanguageToCron(text: string): Promise<string> {
  const llm = getLLMProvider()

  const response = await llm.chat({
    system: `Convert natural language schedule descriptions to standard 5-part cron expressions.
Reply with ONLY the cron expression, nothing else.

Examples:
- "every weekday at 9am" → 0 9 * * 1-5
- "every Monday" → 0 9 * * 1
- "every hour" → 0 * * * *
- "daily at 6pm" → 0 18 * * *
- "every 30 minutes" → */30 * * * *
- "every Sunday at 10am" → 0 10 * * 0
- "twice a day at 9am and 5pm" → 0 9,17 * * *`,
    messages: [{ role: 'user', content: text }],
    tools: [],
    maxTokens: 50,
  })

  const cron = (response.content ?? '').trim()

  // Validate the generated cron
  try {
    CronExpressionParser.parse(cron)
    return cron
  } catch {
    throw new Error(`Failed to parse schedule: "${text}" → "${cron}"`)
  }
}
