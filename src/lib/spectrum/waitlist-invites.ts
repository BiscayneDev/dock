/**
 * Owner command: send "your seat's open" emails to waitlist signups.
 *   "invite next 5"          -> the 5 oldest 'joined' rows
 *   "invite someone@x.com"   -> that signup (joined or invited; re-sends)
 * Each person gets a fresh single-use beta code; the row moves to 'invited'
 * only when the email was accepted by Resend.
 */
import { createServerClient } from '@/lib/supabase/server'
import { mintInvite } from './beta-gate'
import { sendWaitlistInvite } from '@/lib/email/waitlist-invite'
import { normalizeEmail } from '@/lib/waitlist'

export type WaitlistInviteCommand = { kind: 'next'; count: number } | { kind: 'email'; email: string }

const NEXT_RE = /^\s*invite\s+(?:the\s+)?next\s+(\d{1,3})\s*[.!]?\s*$/i
const EMAIL_RE = /^\s*invite\s+(\S+@\S+)\s*[.!]?\s*$/i
export const MAX_INVITES_PER_COMMAND = 25

export function parseWaitlistInviteCommand(text: string): WaitlistInviteCommand | null {
  const n = text.match(NEXT_RE)
  if (n) return { kind: 'next', count: Math.max(1, Math.min(parseInt(n[1], 10), MAX_INVITES_PER_COMMAND)) }
  const e = text.match(EMAIL_RE)
  if (e) {
    const email = normalizeEmail(e[1].replace(/[<>]/g, ''))
    if (email) return { kind: 'email', email }
  }
  return null
}

interface Row { id: string; email: string; name: string | null; status: string }

/** Returns a short lowercase summary for the owner. */
export async function runWaitlistInvites(ownerChat: string, cmd: WaitlistInviteCommand): Promise<string> {
  if (!process.env.RESEND_API_KEY) return "can't send invites yet - RESEND_API_KEY isn't set."
  const supabase = createServerClient()
  const query = supabase.from('waitlist').select('id, email, name, status')
  const { data, error } = cmd.kind === 'next'
    ? await query.eq('status', 'joined').order('created_at', { ascending: true }).limit(cmd.count)
    : await query.eq('email', cmd.email).in('status', ['joined', 'invited']).limit(1)
  if (error) throw new Error(`waitlist select failed: ${error.message}`)
  const rows = (data ?? []) as Row[]
  if (rows.length === 0) {
    return cmd.kind === 'next' ? 'no one waiting on the list right now.' : `${cmd.email} isn't on the list (or is already active).`
  }

  const sent: string[] = []
  const failed: string[] = []
  for (const row of rows) {
    const code = await mintInvite(ownerChat, 1, `waitlist:${row.email}`)
    if (!code) { failed.push(row.email); continue }
    const ok = await sendWaitlistInvite(row.email, row.name ?? '', code)
    if (!ok) { failed.push(row.email); continue }
    await supabase.from('waitlist').update({ status: 'invited', updated_at: new Date().toISOString() }).eq('id', row.id)
    sent.push(row.name ? `${row.name} (${row.email})` : row.email)
  }

  const lines: string[] = []
  if (sent.length) lines.push(`invited ${sent.length}: ${sent.join(', ')}`)
  if (failed.length) lines.push(`couldn't send to: ${failed.join(', ')}`)
  return lines.join('\n')
}
