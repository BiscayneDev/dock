// In-memory sliding window rate limiter
// TODO: Replace with Redis for multi-instance deployments

interface RateLimitEntry {
  timestamps: number[]
}

const store = new Map<string, RateLimitEntry>()

const CLEANUP_INTERVAL_MS = 60_000
let lastCleanup = Date.now()

function cleanup(windowMs: number): void {
  const now = Date.now()
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return
  lastCleanup = now

  const cutoff = now - windowMs
  for (const [key, entry] of store) {
    entry.timestamps = entry.timestamps.filter((t) => t > cutoff)
    if (entry.timestamps.length === 0) {
      store.delete(key)
    }
  }
}

export function isRateLimited(
  key: string,
  maxRequests: number,
  windowMs: number
): boolean {
  cleanup(windowMs)

  const now = Date.now()
  const cutoff = now - windowMs

  const entry = store.get(key)
  if (!entry) {
    store.set(key, { timestamps: [now] })
    return false
  }

  // Remove expired timestamps
  entry.timestamps = entry.timestamps.filter((t) => t > cutoff)

  if (entry.timestamps.length >= maxRequests) {
    return true
  }

  entry.timestamps.push(now)
  return false
}
