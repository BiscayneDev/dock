// Shared time utilities used across cron routes

export function isInQuietHours(
  start: string | null,
  end: string | null,
  timezone: string
): boolean {
  if (!start || !end) return false

  const now = new Date()
  const formatter = new Intl.DateTimeFormat('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: timezone,
  })

  const currentTime = formatter.format(now)
  const [currentHour, currentMin] = currentTime.split(':').map(Number)
  const currentMinutes = currentHour * 60 + currentMin

  const [startHour, startMin] = start.split(':').map(Number)
  const startMinutes = startHour * 60 + startMin

  const [endHour, endMin] = end.split(':').map(Number)
  const endMinutes = endHour * 60 + endMin

  // Handle overnight ranges (e.g., 22:00 - 08:00)
  if (startMinutes > endMinutes) {
    return currentMinutes >= startMinutes || currentMinutes < endMinutes
  }

  return currentMinutes >= startMinutes && currentMinutes < endMinutes
}

export function getCurrentHour(timezone: string): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    hour12: false,
    timeZone: timezone,
  })
  return parseInt(formatter.format(new Date()), 10)
}
