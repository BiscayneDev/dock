// Shared waitlist validation - used by the form (client) and /api/waitlist (server).

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const HANDLE_RE = /^[A-Za-z0-9_]{1,15}$/
export const NAME_MAX = 80

export function normalizeEmail(input: unknown): string | null {
  const v = typeof input === 'string' ? input.trim().toLowerCase() : ''
  return v && EMAIL_RE.test(v) ? v : null
}

/** Trim and collapse whitespace. Returns null if empty or too long. */
export function normalizeName(input: unknown): string | null {
  if (typeof input !== 'string') return null
  const v = input.replace(/\s+/g, ' ').trim()
  if (!v || v.length > NAME_MAX) return null
  return v
}

/**
 * Accepts "@handle", "handle", or an x.com / twitter.com profile URL.
 * Returns the bare handle, '' when blank (optional field), or null when invalid.
 */
export function normalizeTwitterHandle(input: unknown): string | null {
  if (input === undefined || input === null) return ''
  if (typeof input !== 'string') return null
  let v = input.trim()
  if (!v) return ''
  const url = v.match(/^(?:https?:\/\/)?(?:www\.|mobile\.)?(?:x|twitter)\.com\/([^/?#\s]+)/i)
  if (url) v = url[1]
  v = v.replace(/^@/, '')
  return HANDLE_RE.test(v) ? v : null
}
