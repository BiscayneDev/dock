import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { settleUser, type SettleOutcome } from '@/lib/billing/settle'
import { logger } from '@/lib/logger'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

// Threshold-triggered settlement. Finds users whose unsettled inference balance
// is at/over SHIPYARD_SETTLE_THRESHOLD_USD and settles each from their Paybox
// wallet. Decoupled from the request path; runs every few minutes (vercel.json).
// Each user is isolated — one failure never aborts the batch.

const MAX_PER_RUN = 50 // each settle is a slow on-chain round trip; stay within maxDuration

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!process.env.SHIPYARD_TREASURY_WALLET) {
    return NextResponse.json({ skipped: 'no SHIPYARD_TREASURY_WALLET configured' })
  }

  const threshold = Number(process.env.SHIPYARD_SETTLE_THRESHOLD_USD ?? '1.00')
  const supabase = createServerClient()

  const { data: candidates, error } = await supabase.rpc('settle_candidates', {
    p_threshold: threshold,
  })
  if (error) {
    logger.error('settle_candidates failed', { error: error.message })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const rows = (candidates ?? []) as Array<{ user_id: string; owed: number }>
  const batch = rows.slice(0, MAX_PER_RUN)

  const tally: Record<SettleOutcome['status'], number> = {
    settled: 0,
    below_threshold: 0,
    skipped: 0,
    voided: 0,
    frozen: 0,
  }
  const errors: Array<{ userId: string; error: string }> = []

  for (const { user_id } of batch) {
    try {
      const outcome = await settleUser(user_id)
      tally[outcome.status]++
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      errors.push({ userId: user_id, error: message })
      logger.error('settleUser threw', { userId: user_id, error: message })
    }
  }

  return NextResponse.json({
    candidates: rows.length,
    processed: batch.length,
    deferred: Math.max(0, rows.length - batch.length),
    network: process.env.SHIPYARD_SETTLE_NETWORK === 'mainnet' ? 'mainnet' : 'devnet',
    tally,
    errors,
  })
}
