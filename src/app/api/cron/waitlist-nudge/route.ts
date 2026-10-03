/**
 * One email nudge (~36h after the invite) for invitees who never texted. No in-chat
 * nudge: Photon rejects texting a user first. Fires at most once (timestamp claimed
 * before the send, cleared if the send fails). Off unless DINGHY_WAITLIST_NUDGE=on.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { nudgeDue, nudgeEmail, nudgeEnabled, type NudgeRow } from '@/lib/spectrum/waitlist-nudge'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

async function sendNudgeEmail(to: string, subject: string, text: string): Promise<boolean> {
  const key = process.env.RESEND_API_KEY
  if (!key) return false
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: process.env.WAITLIST_FROM_EMAIL || 'Dinghy <hi@getdinghy.sh>', to: [to], subject, text }),
    })
    return res.ok
  } catch { return false }
}

export async function GET(request: NextRequest) {
  if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!nudgeEnabled()) return NextResponse.json({ enabled: false })
  const db = createServerClient()
  const { data, error } = await db.from('waitlist')
    .select('id, name, email, phone, status, dinghy_line, start_token, first_text_at, intro_texted_at, invite_sent_at, chat_nudge_sent_at, nudge_sent_at')
    .eq('status', 'invited').is('first_text_at', null).not('start_token', 'is', null).limit(50)
  if (error) return NextResponse.json({ error: 'Could not read invitees' }, { status: 500 })
  const now = new Date()
  const out = { chat: 0, email: 0, failed: 0 }
  for (const row of (data ?? []) as Array<NudgeRow & { id: string; name: string | null }>) {
    const due = nudgeDue(row, now)
    if (!due) continue
    if (String(row.email).endsWith('.invalid')) continue // invite-link signups have no real email
    const col = due === 'chat' ? 'chat_nudge_sent_at' : 'nudge_sent_at'
    const { data: claimed } = await db.from('waitlist').update({ [col]: now.toISOString() })
      .eq('id', row.id).is(col, null).is('first_text_at', null).select('id')
    if (!claimed?.length) continue
    const token = row.start_token as string
    const ok = await (() => { const m = nudgeEmail(row.name, token); return sendNudgeEmail(row.email as string, m.subject, m.text) })()
    if (ok) out[due]++
    else { out.failed++; await db.from('waitlist').update({ [col]: null }).eq('id', row.id) }
  }
  return NextResponse.json({ enabled: true, ...out })
}
