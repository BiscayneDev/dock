import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { isRateLimited } from '@/lib/rate-limit'
import { normalizeEmail, normalizeName, normalizePhone, normalizeTwitterHandle } from '@/lib/waitlist'
import { sendWaitlistConfirmation } from '@/lib/email/waitlist-confirmation'

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

  const { email, name, twitter, phone } = (body ?? {}) as { email?: unknown; name?: unknown; twitter?: unknown; phone?: unknown }
  const cleanEmail = normalizeEmail(email)
  if (!cleanEmail) {
    return NextResponse.json({ error: 'Please enter a valid email address.' }, { status: 400 })
  }
  const cleanName = normalizeName(name)
  if (!cleanName) {
    return NextResponse.json({ error: 'Please enter your name.' }, { status: 400 })
  }
  // Optional: blank is fine (Dinghy learns the number when they text in).
  const phoneRaw = typeof phone === 'string' ? phone.trim() : ''
  const cleanPhone = phoneRaw ? normalizePhone(phoneRaw) : null
  if (phoneRaw && !cleanPhone) {
    return NextResponse.json({ error: 'That mobile number doesn\'t look right.' }, { status: 400 })
  }
  const handle = normalizeTwitterHandle(twitter)
  if (handle === null) {
    return NextResponse.json({ error: 'That X handle doesn\'t look right - letters, numbers and _ only, up to 15.' }, { status: 400 })
  }

  const row = { email: cleanEmail, name: cleanName, phone: cleanPhone, twitter_handle: handle || null }

  try {
    const supabase = createServerClient()
    // Existing email: keep the original row untouched (an unauthenticated form must not
    // let anyone rewrite someone else's name/handle) and still return success, so we
    // don't leak that the email is already registered.
    const { data, error } = await supabase
      .from('waitlist')
      .upsert(row, { onConflict: 'email', ignoreDuplicates: true })
      .select('id')

    if (error) {
      console.error('Waitlist insert failed:', error.message)
      return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 })
    }

    // Only a brand-new row gets the confirmation email (duplicates return no rows).
    const inserted = data?.[0]?.id as string | undefined
    if (inserted) {
      const sent = await sendWaitlistConfirmation({ email: cleanEmail, name: cleanName, phone: cleanPhone })
      if (sent) {
        await supabase.from('waitlist').update({ confirmation_sent_at: new Date().toISOString() }).eq('id', inserted)
      }
    }

    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 })
  }
}
