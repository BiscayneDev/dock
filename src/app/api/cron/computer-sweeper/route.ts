/**
 * Computer sweeper cron (every 5 min): bill and pause (not kill) sessions
 * idle past 10 minutes, and kill
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
  SandboxGoneError,
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

    // 2. Only act on idle sessions. last_activity_at is the metering
    // baseline: runInSandbox bills the gap since it on the next run, so the
    // sweeper must NOT bump it while the session is merely quiet (that made
    // idle time never reach the threshold, so nothing ever slept).
    const idleSeconds = Math.round((now - new Date(row.last_activity_at).getTime()) / 1000)
    if (idleSeconds < SLEEP_AFTER_IDLE_MINUTES * 60) continue

    // 3. Idle past the threshold: bill the idle wall-clock, then pause the
    // sandbox (files and installs survive; the next run resumes it).
    try {
      await recordSpend(
        row.user_id,
        'sandbox',
        Number((idleSeconds * USD_PER_SECOND).toFixed(6)),
        `${row.id}:${idleSeconds}s idle`,
        supabase
      )
      metered++
    } catch {
      // Ledger write failed: leave the session as is so the next sweep retries.
      continue
    }

    if (row.sandbox_id) {
      try {
        await provider.pause(row.sandbox_id)
      } catch (err) {
        // Pause failed. If the sandbox is gone there is nothing to keep, and
        // the next run swaps in a fresh one. Otherwise stop it so it cannot
        // keep running unmetered.
        if (!(err instanceof SandboxGoneError)) {
          try {
            await provider.stop(row.sandbox_id)
          } catch {
            // Already gone.
          }
        }
      }
    }
    await supabase
      .from('computer_sessions')
      .update({ status: 'sleeping', last_activity_at: new Date(now).toISOString() })
      .eq('id', row.id)
    slept++
  }

  return NextResponse.json({ metered, slept, killed })
}
