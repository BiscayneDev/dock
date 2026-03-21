import { cookies } from 'next/headers'
import { createServerClient } from '@/lib/supabase/server'

const SESSION_COOKIE = 'dock_session'

export interface Session {
  userId: string
  telegramId: number
}

export async function getSession(): Promise<Session | null> {
  const cookieStore = await cookies()
  const sessionCookie = cookieStore.get(SESSION_COOKIE)

  if (!sessionCookie?.value) {
    return null
  }

  try {
    const session = JSON.parse(sessionCookie.value) as Session

    // Verify user exists
    const supabase = createServerClient()
    const { data } = await supabase
      .from('users')
      .select('id')
      .eq('id', session.userId)
      .single()

    if (!data) return null

    return session
  } catch {
    return null
  }
}

export async function setSession(userId: string, telegramId: number): Promise<void> {
  const cookieStore = await cookies()
  const session: Session = { userId, telegramId }

  cookieStore.set(SESSION_COOKIE, JSON.stringify(session), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 7, // 7 days
    path: '/',
  })
}

export async function clearSession(): Promise<void> {
  const cookieStore = await cookies()
  cookieStore.delete(SESSION_COOKIE)
}
