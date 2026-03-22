import { getSession, type Session } from './session'
import { createServerClient } from '@/lib/supabase/server'

export async function getAdminSession(): Promise<Session | null> {
  const session = await getSession()
  if (!session) return null

  const supabase = createServerClient()
  const { data: user } = await supabase
    .from('users')
    .select('is_admin')
    .eq('id', session.userId)
    .single()

  if (!user || !(user.is_admin as boolean)) return null

  return session
}
