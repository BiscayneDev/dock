import { cookies } from 'next/headers'
import { createHmac, timingSafeEqual } from 'crypto'
import { createServerClient } from '@/lib/supabase/server'

const SESSION_COOKIE = 'dock_session'

export interface Session {
  userId: string
  telegramId: number
}

/**
 * Session cookies are signed with ENCRYPTION_KEY (HMAC-SHA256):
 *   value = base64url(payload).base64url(hmac)
 * `userId` in an unsigned/tampered cookie is rejected before any DB lookup.
 * Legacy unsigned cookies (pre-signing deployments) are still ACCEPTED for
 * one release so live sessions don't break, and every read re-issues a
 * signed cookie — see the legacy path in getSession().
 */

function getSecret(): string {
  const secret = process.env.ENCRYPTION_KEY
  if (!secret) throw new Error('ENCRYPTION_KEY is not set — cannot sign sessions')
  return secret
}

function sign(payload: string): string {
  return createHmac('sha256', getSecret()).update(payload).digest('base64url')
}

export function encodeSessionCookie(session: Session): string {
  const payload = Buffer.from(JSON.stringify(session)).toString('base64url')
  return `${payload}.${sign(payload)}`
}

export function decodeSessionCookie(value: string): Session | null {
  const parts = value.split('.')
  if (parts.length !== 2) return null

  const [payload, signature] = parts
  const expected = sign(payload)
  if (signature.length !== expected.length) return null
  if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null

  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Session
    if (!session.userId || typeof session.telegramId !== 'number') return null
    return session
  } catch {
    return null
  }
}

function cookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    maxAge: 60 * 60 * 24 * 7, // 7 days
    path: '/',
  }
}

export async function getSession(): Promise<Session | null> {
  const cookieStore = await cookies()
  const sessionCookie = cookieStore.get(SESSION_COOKIE)

  if (!sessionCookie?.value) {
    return null
  }

  // Legacy unsigned cookies are no longer accepted — the migration window has
  // closed. An unsigned cookie is a forgery vector; reject it outright.
  if (!sessionCookie.value.includes('.')) {
    return null
  }

  const session = decodeSessionCookie(sessionCookie.value)
  if (!session) return null

  // Verify user exists
  const supabase = createServerClient()
  const { data } = await supabase
    .from('users')
    .select('id')
    .eq('id', session.userId)
    .single()

  if (!data) return null

  return session
}

export async function setSession(userId: string, telegramId: number): Promise<void> {
  const cookieStore = await cookies()

  cookieStore.set(SESSION_COOKIE, encodeSessionCookie({ userId, telegramId }), cookieOptions())
}

export async function clearSession(): Promise<void> {
  const cookieStore = await cookies()
  cookieStore.delete(SESSION_COOKIE)
}
