/**
 * Agent Schedule System
 *
 * Built-in cron-like scheduler for autonomous agent work.
 * Stores schedules in data/schedules.json and checks them via /api/schedules/tick.
 */

export interface AgentSchedule {
  id: string
  name: string
  agent: string
  prompt: string
  /** Cron-like frequency: "hourly", "daily", "weekly", or a cron expression */
  frequency: string
  /** Hour of day (0-23) for daily/weekly schedules */
  hour: number
  /** Day of week (0=Sun, 1=Mon...6=Sat) for weekly schedules */
  dayOfWeek?: number
  /** Timezone label for display */
  timezone: string
  enabled: boolean
  lastRunAt: string | null
  nextRunAt: string | null
  lastStatus: "success" | "error" | null
  lastError: string | null
  createdAt: string
}

/**
 * Calculate the next run time for a schedule
 */
export function calculateNextRun(schedule: AgentSchedule): Date {
  const now = new Date()
  const next = new Date()
  next.setMinutes(0, 0, 0)

  switch (schedule.frequency) {
    case "hourly":
      // Next hour
      next.setHours(now.getHours() + 1)
      break

    case "daily":
      // Today at the specified hour, or tomorrow if already past
      next.setHours(schedule.hour)
      if (next <= now) {
        next.setDate(next.getDate() + 1)
      }
      break

    case "weekly":
      // Next occurrence of dayOfWeek at the specified hour
      next.setHours(schedule.hour)
      const targetDay = schedule.dayOfWeek ?? 1
      const currentDay = next.getDay()
      let daysUntil = targetDay - currentDay
      if (daysUntil < 0 || (daysUntil === 0 && next <= now)) {
        daysUntil += 7
      }
      next.setDate(next.getDate() + daysUntil)
      break

    default:
      // Unknown frequency — default to 1 hour
      next.setHours(now.getHours() + 1)
  }

  return next
}

/**
 * Check if a schedule is due to run
 */
export function isDue(schedule: AgentSchedule, now: Date = new Date()): boolean {
  if (!schedule.enabled) return false
  if (!schedule.nextRunAt) return true

  const nextRun = new Date(schedule.nextRunAt)
  return now >= nextRun
}

/**
 * Pure: all schedules due at `now`. Same predicate as isDue with an injected clock.
 */
export function dueSchedules(now: Date, schedules: AgentSchedule[]): AgentSchedule[] {
  return schedules.filter((s) => isDue(s, now))
}

/** FeedId convention for a schedule's watermark. */
export function scheduleFeedId(scheduleId: string): string {
  return `schedule:${scheduleId}`
}

export const DAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]

export const FREQUENCY_OPTIONS = [
  { value: "hourly", label: "Every hour" },
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
]
