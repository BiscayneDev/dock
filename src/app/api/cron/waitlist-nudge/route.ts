/** Prepared but disabled until the owner reviews the final email and audience. */
import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'


export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const cutoff = new Date(Date.now() - 36 * 60 * 60 * 1000).toISOString()
  const db = createServerClient()
  const { data, error } = await db.from('waitlist')
    .select('id, email, dinghy_line, start_token, invite_sent_at')
    .eq('status', 'invited').is('first_text_at', null).is('nudge_sent_at', null)
    .lt('invite_sent_at', cutoff).not('dinghy_line', 'is', null).not('start_token', 'is', null).limit(25)
  if (error) return NextResponse.json({ error: 'Could not read eligible invitees' }, { status: 500 })
  // No send path until the reviewed copy and recipient scope are approved.
  return NextResponse.json({ enabled: false, eligible: data?.length ?? 0 })
}
