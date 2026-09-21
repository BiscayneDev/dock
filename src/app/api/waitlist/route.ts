import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { email } = body as { email?: unknown }
  const trimmed = typeof email === 'string' ? email.trim().toLowerCase() : ''

  if (!trimmed || !EMAIL_RE.test(trimmed)) {
    return NextResponse.json({ error: 'Please enter a valid email address.' }, { status: 400 })
  }

  try {
    const supabase = createServerClient()
    // upsert with onConflict — if email already exists, return success (idempotent)
    // rather than leaking that the email is already registered.
    const { error } = await supabase
      .from('waitlist')
      .upsert({ email: trimmed }, { onConflict: 'email' })

    if (error) {
      console.error('Waitlist insert failed:', error.message)
      return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 })
  }
}
