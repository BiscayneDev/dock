import { NextRequest, NextResponse } from 'next/server'
import { verifyMagicToken } from '@/lib/auth/magic-link'
import { createServerClient } from '@/lib/supabase/server'
import { setSession } from '@/lib/auth/session'

export async function GET(request: NextRequest): Promise<NextResponse> {
  const token = request.nextUrl.searchParams.get('token')
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

  if (!token) {
    return NextResponse.redirect(`${appUrl}/onboarding?error=missing_token`)
  }

  const payload = verifyMagicToken(token)
  if (!payload) {
    return NextResponse.redirect(`${appUrl}/onboarding?error=invalid_or_expired_token`)
  }

  const supabase = createServerClient()

  // Upsert user
  const { data: user, error } = await supabase
    .from('users')
    .upsert(
      {
        telegram_id: payload.telegramId,
        telegram_username: payload.username,
        name: payload.name,
      },
      { onConflict: 'telegram_id' }
    )
    .select('id, telegram_id')
    .single()

  if (error || !user) {
    return NextResponse.redirect(`${appUrl}/onboarding?error=user_creation_failed`)
  }

  await setSession(user.id as string, user.telegram_id as number)

  // Check if user has any connected integrations
  const { count: integrationCount } = await supabase
    .from('oauth_tokens')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', user.id)

  // First-time users go to onboarding to connect accounts
  // Returning users with integrations go to Harbor
  if ((integrationCount ?? 0) > 0) {
    return NextResponse.redirect(`${appUrl}/harbor`)
  }

  return NextResponse.redirect(`${appUrl}/onboarding`)
}
