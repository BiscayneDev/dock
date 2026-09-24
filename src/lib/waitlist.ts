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

/**
 * Normalize a phone number to E.164. Bare 10-digit numbers are treated as US (+1).
 * Accepts spaces, dashes, dots and parentheses. Returns null when invalid.
 */
export function normalizePhone(input: unknown): string | null {
  if (typeof input !== 'string') return null
  const raw = input.trim()
  if (!raw) return null
  const hasPlus = raw.startsWith('+')
  if (/[^\d\s().+-]/.test(raw)) return null
  const digits = raw.replace(/\D/g, '')
  let e164: string
  if (hasPlus) e164 = `+${digits}`
  else if (digits.length === 10) e164 = `+1${digits}`
  else if (digits.length === 11 && digits.startsWith('1')) e164 = `+${digits}`
  else return null
  return /^\+[1-9]\d{7,14}$/.test(e164) ? e164 : null
}

/** "+14155550123" -> "(•••) •••-0123" for US, "•••0123" otherwise. */
export function maskPhone(e164: string): string {
  const last4 = e164.slice(-4)
  return e164.startsWith('+1') && e164.length === 12 ? `(•••) •••-${last4}` : `•••${last4}`
}
