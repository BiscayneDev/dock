import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { readPortfolio } from '@/lib/profile/paybox-read'
export const dynamic = 'force-dynamic'
const headers = { 'Cache-Control': 'private, no-store' }
export async function GET(): Promise<NextResponse> {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers })
  try { return NextResponse.json(await readPortfolio(session.userId), { headers }) }
  catch { return NextResponse.json({ error: 'Wallet value unavailable' }, { status: 503, headers }) }
}
