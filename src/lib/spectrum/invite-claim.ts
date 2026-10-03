/**
 * Referral link claim: the invitee gives a phone number on /i/<code>, we give
 * them a seat the same way a waitlist invite does (Photon line, allowlist,
 * identity, start token) and send them to /start/<token>: connect Google, see
 * the exact number to text, text it. The code is only burned once the line is
 * assigned, and a number that already has a seat is never handed a token.
 */
import { randomBytes } from 'crypto'
import { createServerClient } from '@/lib/supabase/server'
import { hashInviteCode, redeemInvite } from './beta-gate'
import { registerPhotonUser } from './photon-users'
import { provisionSpectrumIdentity } from './provision'
import { chatGuidForPhone } from './waitlist-invites'

export const INVITE_CODE_FORMAT = /^[A-Z2-9]{4}-[A-Z2-9]{4}$/
/** Placeholder email for rows with no email. Never mailed (.invalid). */
export const INVITEE_EMAIL_SUFFIX = '@invitee.invalid'

/** US numbers without a country code get +1; anything else needs a leading +. Null when it isn't a phone. */
export function normalizePhone(input: string): string | null {
  const raw = (input ?? '').trim()
  const digits = raw.replace(/\D/g, '')
  if (raw.startsWith('+')) return /^[1-9]\d{7,14}$/.test(digits) ? `+${digits}` : null
  if (digits.length === 10 && /^[2-9]/.test(digits)) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1') && /^[2-9]/.test(digits.slice(1))) return `+${digits}`
  return null
}

export function cleanName(input: string): string | null {
  const n = (input ?? '').trim().replace(/\s+/g, ' ').slice(0, 80)
  return n && /^[\p{L}][\p{L}\p{M}' .-]*$/u.test(n) ? n : null
}

export type ClaimResult =
  | { ok: true; token: string }
  | { ok: false; reason: 'bad_code' | 'bad_phone' | 'has_seat' | 'no_line' | 'try_again' }

export async function claimInvite(codeIn: string, phoneIn: string, nameIn: string): Promise<ClaimResult> {
  const code = decodeURIComponent(codeIn ?? '').toUpperCase()
  if (!INVITE_CODE_FORMAT.test(code)) return { ok: false, reason: 'bad_code' }
  const phone = normalizePhone(phoneIn)
  if (!phone) return { ok: false, reason: 'bad_phone' }
  const name = cleanName(nameIn)
  const db = createServerClient()
  const chatGuid = chatGuidForPhone(phone)
  try {
    const { data: inv, error: invErr } = await db.from('beta_invites')
      .select('uses, max_uses, expires_at').eq('code_hash', hashInviteCode(code)).maybeSingle()
    if (invErr || !inv || inv.uses >= inv.max_uses || new Date(inv.expires_at) <= new Date()) return { ok: false, reason: 'bad_code' }

    // A joined waitlist row without provisioning is not a seat. Reuse its row,
    // but never return an existing token or reveal its email/name to the claimant.
    const { data: allowed } = await db.from('beta_allowlist').select('chat_guid').eq('chat_guid', chatGuid).maybeSingle()
    const { data: existing, error: existingErr } = await db.from('waitlist')
      .select('id, status, start_token, photon_user_id, dinghy_line').eq('phone', phone).limit(2)
    if (existingErr || (existing?.length ?? 0) > 1) return { ok: false, reason: 'try_again' }
    const waiting = existing?.[0]
    if (allowed || (waiting && (waiting.status !== 'joined' || waiting.start_token || waiting.photon_user_id || waiting.dinghy_line))) return { ok: false, reason: 'has_seat' }

    const user = await registerPhotonUser(phone, name)
    if (!user) return { ok: false, reason: 'no_line' }

    const redeemed = await redeemInvite(chatGuid, code)
    if (redeemed !== 'ok') return { ok: false, reason: redeemed === 'already' ? 'has_seat' : 'bad_code' }

    const token = randomBytes(24).toString('base64url')
    const now = new Date().toISOString()
    const seat = { status: 'invited', start_token: token,
      photon_user_id: user.id, dinghy_line: user.assignedPhoneNumber, line_assigned_at: now, updated_at: now }
    const { data: saved, error: rowErr } = waiting
      ? await db.from('waitlist').update(seat).eq('id', waiting.id).eq('status', 'joined')
        .is('start_token', null).is('photon_user_id', null).is('dinghy_line', null).select('id')
      : await db.from('waitlist').insert({
        email: `invite-${randomBytes(6).toString('hex')}${INVITEE_EMAIL_SUFFIX}`, name, phone, ...seat,
      }).select('id')
    if (!rowErr && saved?.length !== 1) return { ok: false, reason: 'try_again' }
    if (rowErr) throw new Error(`waitlist insert failed: ${rowErr.message}`)
    await provisionSpectrumIdentity(chatGuid, phone).catch(() => null)
    return { ok: true, token }
  } catch (err) {
    console.error('invite claim failed:', err instanceof Error ? err.message : String(err))
    return { ok: false, reason: 'try_again' }
  }
}

export const CLAIM_ERRORS: Record<string, string> = {
  bad_phone: 'That does not look like a phone number. Use the number of the iPhone you will text from.',
  has_seat: 'That number already has a seat. Text your Dinghy line, or ask your friend for help if you lost it.',
  no_line: 'I could not set up a line for that number. Try again in a minute.',
  try_again: 'Something went wrong on my side. Try again in a minute.',
}
