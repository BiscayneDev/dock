/**
 * Waitlist admit queue (cron, every minute): runs the existing invite flow for
 * queued waitlist_admit_queue rows (migration 065). One email per row, waitlist
 * rows only. See src/lib/spectrum/waitlist-admit.ts.
 */
import { NextRequest, NextResponse } from 'next/server'
import { processAdmitQueue } from '@/lib/spectrum/waitlist-admit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    return NextResponse.json({ ok: true, ...(await processAdmitQueue()) })
  } catch (err) {
    console.error('waitlist admit failed:', err instanceof Error ? err.message : String(err))
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}
