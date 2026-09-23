import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { isRateLimited } from '@/lib/rate-limit'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// 5 POSTs per IP per hour. In-memory sliding window — acceptable for now;
// swap in Supabase/Upstash-backed limiting before multi-instance deploys.
const RATE_LIMIT_MAX = 5
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000

function clientIp(request: NextRequest): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    request.headers.get('x-real-ip') ??
    'unknown'
  )
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (isRateLimited(`waitlist:${clientIp(request)}`, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS)) {
    return NextResponse.json(
      { error: 'Too many requests. Please try again later.' },
      { status: 429 }
    )
  }

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
