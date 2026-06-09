import { logger } from '@/lib/logger'

// Whether an LLM/API error is worth retrying: rate limits, server errors,
// overload, and transient network failures. Auth/validation errors are not.
function isRetryable(err: unknown): boolean {
  const status = (err as { status?: number })?.status
  if (typeof status === 'number' && (status === 429 || status >= 500)) return true
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase()
  return /rate limit|overloaded|timeout|timed out|econnreset|econnrefused|fetch failed|network|socket hang up|503|502|529/.test(
    msg
  )
}

// Retry an async op with exponential backoff (0.5s, 1s, 2s) on transient errors.
export async function withRetry<T>(
  fn: () => Promise<T>,
  label: string,
  attempts = 3
): Promise<T> {
  let lastErr: unknown
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      if (attempt === attempts - 1 || !isRetryable(err)) break
      const delayMs = 500 * 2 ** attempt
      logger.warn('Retrying after transient error', {
        label,
        attempt: attempt + 1,
        delayMs,
        error: err instanceof Error ? err.message : String(err),
      })
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }
  }
  throw lastErr
}
