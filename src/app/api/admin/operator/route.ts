import { NextResponse } from 'next/server'
import { getAdminSession } from '@/lib/auth/admin'
import { createServerClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function GET(): Promise<NextResponse> {
  if (!(await getAdminSession())) return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
  const { data, error } = await createServerClient().rpc('dinghy_operator_overview')
  if (error || !data) {
    console.error('operator overview failed:', error?.message ?? 'empty result')
    return NextResponse.json({ error: 'Operator data unavailable' }, { status: 500 })
  }
  return NextResponse.json(data, { headers: { 'Cache-Control': 'private, no-store' } })
}
