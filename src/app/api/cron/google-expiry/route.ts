/**
 * Daily retention for Gmail/Calendar-derived rows (messages, facts, summaries).
 * Off unless DINGHY_GOOGLE_EXPIRY=on. Days default to 30 (GOOGLE_DERIVED_TTL_DAYS).
 * The data-use text must state the same number.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { googleTtlDays } from '@/lib/spectrum/google-retention'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (process.env.DINGHY_GOOGLE_EXPIRY !== 'on') return NextResponse.json({ enabled: false })
  const days = googleTtlDays()
  const { data, error } = await createServerClient().rpc('expire_google_derived', { p_days: days })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ enabled: true, days, deleted: data })
}
