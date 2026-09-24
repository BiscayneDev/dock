/**
 * Owner command: approve waitlist signups.
 *   "invite next 5"          -> the 5 oldest 'joined' rows
 *   "invite someone@x.com"   -> that signup (joined or invited; re-sends)
 *
 * For each person with a phone:
 *   1. register them as a Photon user -> their own assigned Dinghy line
 *   2. put their number on the beta allowlist (the registered number IS the
 *      proof - no invite code to redeem)
 *   3. Dinghy tries an intro text from their line
 *   4. the invite email goes out as backup, carrying their personal number
 *
 * Photon's shared pool currently rejects a first text to someone who hasn't
 * messaged their line yet ("Target not allowed for this project"), so step 3
 * can fail; the email's tap-to-text link covers it.
 *
 * No phone on file means no Photon user and no line that can reach them, so
 * those rows are skipped and named in the reply.
 */
import { createServerClient } from '@/lib/supabase/server'
import { sendWaitlistInvite } from '@/lib/email/waitlist-invite'
import { firstName } from '@/lib/email/waitlist-confirmation'
import { normalizeEmail } from '@/lib/waitlist'
import { registerPhotonUser } from './photon-users'
import { toPlainText } from '@/lib/spectrum/plain-text'

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

interface Row { id: string; email: string; name: string | null; status: string; phone: string | null }

export function introText(name: string): string {
  const first = firstName(name)
  return `Hi${first ? ` ${first}` : ''}, it's Dinghy. You're in the beta. Save this number and text me whatever you need.`
}

export function chatGuidForPhone(phone: string): string {
  return `any;-;${phone}`
}

/** Dinghy's first text, from the person's own line. False when Photon refuses or anything fails. */
export async function sendIntroText(phone: string, text: string): Promise<boolean> {
  try {
    const { getSpectrumApp, getImessage } = await import('./app')
    const im = await getImessage(await getSpectrumApp())
    const space = await im.space.create(phone)
    await space.send(toPlainText(text))
    return true
  } catch (err) {
    console.error('waitlist intro text failed:', err instanceof Error ? err.message : String(err))
    return false
  }
}

/** Returns a short lowercase summary for the owner. */
export async function runWaitlistInvites(_ownerChat: string, cmd: WaitlistInviteCommand): Promise<string> {
  if (!process.env.RESEND_API_KEY) return "Can't send invites yet - RESEND_API_KEY isn't set."
  const supabase = createServerClient()
  const query = supabase.from('waitlist').select('id, email, name, status, phone')
  const { data, error } = cmd.kind === 'next'
    ? await query.eq('status', 'joined').order('created_at', { ascending: true }).limit(cmd.count)
    : await query.eq('email', cmd.email).in('status', ['joined', 'invited']).limit(1)
  if (error) throw new Error(`waitlist select failed: ${error.message}`)
  const rows = (data ?? []) as Row[]
  if (rows.length === 0) {
    return cmd.kind === 'next' ? 'No one is waiting on the list right now.' : `${cmd.email} isn't on the list (or is already active).`
  }

  const texted: string[] = []
  const emailed: string[] = []
  const noPhone: string[] = []
  const failed: string[] = []
  for (const row of rows) {
    const who = row.name ? `${row.name} (${row.email})` : row.email
    // Without a phone there's no Photon user, so no line that can reach them.
    if (!row.phone) { noPhone.push(row.email); continue }
    const user = await registerPhotonUser(row.phone, row.name)
    if (!user) { failed.push(`${row.email} (couldn't assign a line)`); continue }
    await supabase.from('waitlist').update({ photon_user_id: user.id, dinghy_line: user.assignedPhoneNumber }).eq('id', row.id)

    // Registered number = credential: allowlist it (no code).
    const { error: allowErr } = await supabase.from('beta_allowlist').upsert(
      { chat_guid: chatGuidForPhone(row.phone), role: 'member', note: `waitlist approve: ${row.email}` },
      { onConflict: 'chat_guid', ignoreDuplicates: true },
    )
    if (allowErr) { failed.push(`${row.email} (couldn't allowlist)`); continue }

    const didText = await sendIntroText(row.phone, introText(row.name ?? ''))
    const didEmail = await sendWaitlistInvite(row.email, row.name ?? '', user.assignedPhoneNumber)
    if (!didText && !didEmail) { failed.push(row.email); continue }

    const now = new Date().toISOString()
    await supabase.from('waitlist')
      .update({ status: 'invited', updated_at: now, ...(didText ? { intro_texted_at: now } : {}) })
      .eq('id', row.id)
    ;(didText ? texted : emailed).push(`${who} -> ${user.assignedPhoneNumber}`)
  }

  const lines: string[] = []
  if (texted.length) lines.push(`Texted ${texted.length}: ${texted.join(', ')}`)
  if (emailed.length) lines.push(`Emailed ${emailed.length} (the text didn't go through - they're allowlisted and just need to text their line): ${emailed.join(', ')}`)
  if (noPhone.length) lines.push(`No phone on file, skipped: ${noPhone.join(', ')}`)
  if (failed.length) lines.push(`Couldn't invite: ${failed.join(', ')}`)
  return lines.join('\n')
}
