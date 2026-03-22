import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createServerClient } from '@/lib/supabase/server'
import { getSession } from '@/lib/auth/session'

const UpdateSettingsBody = z.object({
  timezone: z.string().optional(),
  quiet_hours_start: z.string().regex(/^\d{2}:\d{2}$/).optional().nullable(),
  quiet_hours_end: z.string().regex(/^\d{2}:\d{2}$/).optional().nullable(),
  daily_briefing: z.boolean().optional(),
})

// GET current settings
export async function GET(): Promise<NextResponse> {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createServerClient()
  const { data, error } = await supabase
    .from('users')
    .select('timezone, quiet_hours_start, quiet_hours_end, daily_briefing, wallet_address, wallet_chain, created_at')
    .eq('id', session.userId)
    .single()

  if (error || !data) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }

  return NextResponse.json({ settings: data })
}

// PATCH update settings
export async function PATCH(request: NextRequest): Promise<NextResponse> {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = UpdateSettingsBody.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', issues: parsed.error.issues }, { status: 400 })
  }

  // Validate timezone if provided
  if (parsed.data.timezone) {
    try {
      Intl.DateTimeFormat(undefined, { timeZone: parsed.data.timezone })
    } catch {
      return NextResponse.json({ error: 'Invalid timezone' }, { status: 400 })
    }
  }

  const supabase = createServerClient()
  const { error } = await supabase
    .from('users')
    .update(parsed.data)
    .eq('id', session.userId)

  if (error) {
    return NextResponse.json({ error: 'Failed to update settings' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}

// DELETE account
export async function DELETE(): Promise<NextResponse> {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createServerClient()

  // Delete in order to respect FK constraints (cascade should handle most, but be explicit)
  await supabase.from('recipe_runs').delete().eq('user_id', session.userId)
  await supabase.from('recipes').delete().eq('user_id', session.userId)
  await supabase.from('messages').delete().eq('user_id', session.userId)
  await supabase.from('reminders').delete().eq('user_id', session.userId)
  await supabase.from('oauth_tokens').delete().eq('user_id', session.userId)
  await supabase.from('users').delete().eq('id', session.userId)

  return NextResponse.json({ success: true })
}
