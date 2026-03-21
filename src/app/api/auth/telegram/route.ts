import { NextRequest, NextResponse } from 'next/server'
import { TelegramLoginDataSchema, verifyTelegramAuth } from '@/lib/telegram/auth'
import { createServerClient } from '@/lib/supabase/server'
import { setSession } from '@/lib/auth/session'

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = TelegramLoginDataSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid auth data' }, { status: 400 })
  }

  const authData = parsed.data

  if (!verifyTelegramAuth(authData)) {
    return NextResponse.json({ error: 'Authentication failed' }, { status: 401 })
  }

  const supabase = createServerClient()

  const name = [authData.first_name, authData.last_name].filter(Boolean).join(' ')

  // Upsert user
  const { data: user, error } = await supabase
    .from('users')
    .upsert(
      {
        telegram_id: authData.id,
        telegram_username: authData.username ?? null,
        name,
      },
      { onConflict: 'telegram_id' }
    )
    .select('id, telegram_id')
    .single()

  if (error || !user) {
    return NextResponse.json({ error: 'Failed to create user' }, { status: 500 })
  }

  await setSession(user.id as string, user.telegram_id as number)

  return NextResponse.json({ success: true, userId: user.id })
}
