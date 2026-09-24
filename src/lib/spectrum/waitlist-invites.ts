/**
 * Owner command: approve waitlist signups.
 *   "invite next 5"          -> the 5 oldest 'joined' rows
 *   "invite someone@x.com"   -> that signup (joined or invited; re-sends)
 *
 * For each person:
 *   1. register them as a Photon user -> their own assigned Dinghy line
 *   2. mint a fresh single-use beta code
 *   3. Dinghy tries an intro text from their line
 *   4. the invite email goes out as backup, carrying their personal number
 *
 * Photon's shared pool currently rejects a first text to someone who hasn't
 * messaged their line yet ("Target not allowed for this project"), so step 3
 * can fail; the email's tap-to-text link covers it. The row moves to 'invited'
 * when the text or the email landed.
 */
import { createServerClient } from '@/lib/supabase/server'
import { mintInvite } from './beta-gate'
import { sendWaitlistInvite } from '@/lib/email/waitlist-invite'
import { firstName } from '@/lib/email/waitlist-confirmation'
import { normalizeEmail } from '@/lib/waitlist'
import { registerPhotonUser } from './photon-users'

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

export function introText(name: string, code: string): string {
  const first = firstName(name).toLowerCase()
  return `ahoy${first ? ` ${first}` : ''} - it's dinghy. your seat's open. reply with your code ${code} and i'll bring you aboard.`
}

/** Dinghy's first text, from the person's own line. False when Photon refuses or anything fails. */
export async function sendIntroText(phone: string, text: string): Promise<boolean> {
  try {
    const { getSpectrumApp, getImessage } = await import('./app')
    const im = await getImessage(await getSpectrumApp())
    const space = await im.space.create(phone)
    await space.send(text)
    return true
  } catch (err) {
    console.error('waitlist intro text failed:', err instanceof Error ? err.message : String(err))
    return false
  }
}

/** Returns a short lowercase summary for the owner. */
export async function runWaitlistInvites(ownerChat: string, cmd: WaitlistInviteCommand): Promise<string> {
  if (!process.env.RESEND_API_KEY) return "can't send invites yet - RESEND_API_KEY isn't set."
  const supabase = createServerClient()
  const query = supabase.from('waitlist').select('id, email, name, status, phone')
  const { data, error } = cmd.kind === 'next'
    ? await query.eq('status', 'joined').order('created_at', { ascending: true }).limit(cmd.count)
    : await query.eq('email', cmd.email).in('status', ['joined', 'invited']).limit(1)
  if (error) throw new Error(`waitlist select failed: ${error.message}`)
  const rows = (data ?? []) as Row[]
  if (rows.length === 0) {
    return cmd.kind === 'next' ? 'no one waiting on the list right now.' : `${cmd.email} isn't on the list (or is already active).`
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

    const code = await mintInvite(ownerChat, 1, `waitlist:${row.email}`)
    if (!code) { failed.push(row.email); continue }

    const didText = await sendIntroText(row.phone, introText(row.name ?? '', code))
    const didEmail = await sendWaitlistInvite(row.email, row.name ?? '', code, user.assignedPhoneNumber)
    if (!didText && !didEmail) { failed.push(row.email); continue }

    const now = new Date().toISOString()
    await supabase.from('waitlist')
      .update({ status: 'invited', updated_at: now, ...(didText ? { intro_texted_at: now } : {}) })
      .eq('id', row.id)
    ;(didText ? texted : emailed).push(`${who} -> ${user.assignedPhoneNumber}`)
  }

  const lines: string[] = []
  if (texted.length) lines.push(`texted ${texted.length}: ${texted.join(', ')}`)
  if (emailed.length) lines.push(`emailed ${emailed.length} (text didn't go through - they need to text their line first): ${emailed.join(', ')}`)
  if (noPhone.length) lines.push(`no phone on file, skipped: ${noPhone.join(', ')}`)
  if (failed.length) lines.push(`couldn't invite: ${failed.join(', ')}`)
  return lines.join('\n')
}
