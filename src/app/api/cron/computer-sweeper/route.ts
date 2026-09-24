/**
 * Computer sweeper cron (every 5 min): meter running sessions' elapsed
 * seconds into the ledger, sleep sessions idle past 10 minutes, and kill
 * any session over the daily hard cap. The kill switch is server-side —
 * the sandbox is stopped from here, never from inside it.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { recordSpend } from '@/lib/payments/spend-caps'
import {
  getProvider,
  stopSession,
  SLEEP_AFTER_IDLE_MINUTES,
  USD_PER_SECOND,
  type ComputerSessionRow,
} from '@/lib/computer/manager'
import { killIfOverCap } from '@/lib/computer/metering'

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createServerClient()
  const provider = getProvider()

  const { data: sessions, error } = await supabase
    .from('computer_sessions')
    .select('*')
    .in('status', ['running', 'sleeping'])

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (!sessions || sessions.length === 0) {
    return NextResponse.json({ metered: 0, slept: 0, killed: 0 })
  }

  let metered = 0
  let slept = 0
  let killed = 0
  const now = Date.now()

  for (const row of sessions as ComputerSessionRow[]) {
    // 1. Kill switch first: a session over the hard cap dies regardless.
    const wasKilled = await killIfOverCap(row.user_id, row, (s, reason) => stopSession(s, reason, supabase, provider), supabase)
    if (wasKilled) {
      killed++
      continue
    }

    if (row.status !== 'running' || !row.last_activity_at) continue

    // 2. Meter the elapsed wall-clock seconds since the last bump.
    const idleMs = now - new Date(row.last_activity_at).getTime()
    const elapsedSeconds = Math.round(idleMs / 1000)
    if (elapsedSeconds > 0) {
      try {
        await recordSpend(
          row.user_id,
          'sandbox',
          Number((elapsedSeconds * USD_PER_SECOND).toFixed(6)),
          `${row.id}:${elapsedSeconds}s`,
          supabase
        )
        metered++
      } catch {
        // Ledger write failed — leave the session untouched so the next
        // sweep retries metering rather than silently dropping the cost.
        continue
      }
    }

    // 3. Idle past the sleep threshold → sleep the sandbox (E2B pause if
    // available later; v1 just stops it and marks the session sleeping).
    if (elapsedSeconds >= SLEEP_AFTER_IDLE_MINUTES * 60) {
      if (row.sandbox_id) {
        try {
          await provider.stop(row.sandbox_id)
        } catch {
          // Sandbox may already be gone; the row still moves to sleeping.
        }
      }
      await supabase.from('computer_sessions').update({ status: 'sleeping' }).eq('id', row.id)
      slept++
    } else {
      await supabase.from('computer_sessions').update({ last_activity_at: new Date(now).toISOString() }).eq('id', row.id)
    }
  }

  return NextResponse.json({ metered, slept, killed })
}
