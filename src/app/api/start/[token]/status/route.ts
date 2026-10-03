import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { firstLookCopy, type FirstLookStatus } from '@/lib/spectrum/start-link'

export const dynamic = 'force-dynamic'

/** Phase of the first look for a start token. Carries no phone, number or Google content. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }): Promise<NextResponse> {
  const { token } = await params
  const none = NextResponse.json({ status: null }, { status: 404, headers: { 'Cache-Control': 'no-store' } })
  if (!/^[A-Za-z0-9_-]{32}$/.test(token)) return none
  const { data } = await createServerClient().from('waitlist').select('first_look_status').eq('start_token', token).maybeSingle()
  const status = (data?.first_look_status ?? null) as FirstLookStatus | null
  if (!status) return none
  return NextResponse.json({ status, ...firstLookCopy(status) }, { headers: { 'Cache-Control': 'no-store' } })
}
