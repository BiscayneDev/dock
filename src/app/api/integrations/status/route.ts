import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getSession } from '@/lib/auth/session'

export async function GET(): Promise<NextResponse> {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createServerClient()

  const { data: tokens } = await supabase
    .from('oauth_tokens')
    .select('provider')
    .eq('user_id', session.userId)

  const connected = new Set((tokens ?? []).map((t) => t.provider as string))

  return NextResponse.json({
    google: connected.has('google'),
    notion: connected.has('notion'),
    github: connected.has('github'),
    openwallet: connected.has('openwallet'),
    oura: connected.has('oura'),
    whoop: connected.has('whoop'),
  })
}
