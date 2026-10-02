import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { listFiles } from '@/lib/profile/files'
export const dynamic = 'force-dynamic'
const headers = { 'Cache-Control': 'private, no-store' }
export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers })
  const page = Number(request.nextUrl.searchParams.get('page') ?? 0)
  if (!Number.isInteger(page) || page < 0 || page > 100) return NextResponse.json({ error: 'Invalid page' }, { status: 400, headers })
  try { return NextResponse.json(await listFiles(session.userId, page), { headers }) }
  catch { return NextResponse.json({ error: 'Files unavailable' }, { status: 503, headers }) }
}
