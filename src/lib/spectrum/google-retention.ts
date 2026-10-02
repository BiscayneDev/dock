/** Days Gmail/Calendar-derived rows are kept. Default 30; the data-use text must say the same. */
export function googleTtlDays(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.GOOGLE_DERIVED_TTL_DAYS)
  return Number.isInteger(n) && n >= 1 && n <= 365 ? n : 30
}
