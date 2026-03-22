import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getAdminSession } from '@/lib/auth/admin'

export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await getAdminSession()
  if (!session) {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
  }

  const page = parseInt(request.nextUrl.searchParams.get('page') ?? '0', 10)
  const limit = 50
  const offset = page * limit

  const supabase = createServerClient()

  const { data: users, count } = await supabase
    .from('users')
    .select('id, telegram_id, telegram_username, name, timezone, daily_briefing, wallet_address, is_admin, created_at', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  // Get message counts and integration counts per user
  const userIds = (users ?? []).map((u) => u.id as string)

  const enriched = await Promise.all(
    (users ?? []).map(async (user) => {
      const [messageCount, integrations, recipeCount] = await Promise.all([
        supabase.from('messages').select('*', { count: 'exact', head: true }).eq('user_id', user.id),
        supabase.from('oauth_tokens').select('provider').eq('user_id', user.id),
        supabase.from('recipes').select('*', { count: 'exact', head: true }).eq('user_id', user.id),
      ])

      return {
        ...user,
        messageCount: messageCount.count ?? 0,
        recipeCount: recipeCount.count ?? 0,
        integrations: (integrations.data ?? []).map((t) => t.provider as string),
      }
    })
  )

  return NextResponse.json({
    users: enriched,
    total: count ?? 0,
    page,
    pages: Math.ceil((count ?? 0) / limit),
  })
}

// Toggle admin status
export async function PATCH(request: NextRequest): Promise<NextResponse> {
  const session = await getAdminSession()
  if (!session) {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
  }

  const body = (await request.json()) as { userId: string; isAdmin: boolean }
  const supabase = createServerClient()

  await supabase
    .from('users')
    .update({ is_admin: body.isAdmin })
    .eq('id', body.userId)

  return NextResponse.json({ updated: true })
}
