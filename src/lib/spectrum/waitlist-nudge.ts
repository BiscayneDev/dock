import { startLink } from './start-link'

export const CHAT_NUDGE_AFTER_MS = 4 * 3600_000
export const CHAT_NUDGE_STALE_MS = 30 * 3600_000
export const EMAIL_NUDGE_AFTER_MS = 36 * 3600_000

export interface NudgeRow {
  status: string
  first_text_at: string | null
  intro_texted_at: string | null
  invite_sent_at: string | null
  chat_nudge_sent_at: string | null
  nudge_sent_at: string | null
  phone: string | null
  email: string | null
  dinghy_line: string | null
  start_token: string | null
}

export function nudgeEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.DINGHY_WAITLIST_NUDGE === 'on'
}

/** No texting people overnight. Waitlist has no timezone, so use US Eastern. */
export function inQuietHours(now: Date, tz = 'America/New_York'): boolean {
  const h = Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: tz }).format(now)) % 24
  return h >= 21 || h < 8
}

/** Which nudge is due now, if any. Silence means no first text ever arrived. */
export function nudgeDue(row: NudgeRow, now: Date): 'chat' | 'email' | null {
  if (row.status !== 'invited' || row.first_text_at) return null
  const anchorIso = row.intro_texted_at ?? row.invite_sent_at
  if (!anchorIso || !row.dinghy_line || !row.start_token) return null
  const age = now.getTime() - new Date(anchorIso).getTime()
  const inviteAge = row.invite_sent_at ? now.getTime() - new Date(row.invite_sent_at).getTime() : age
  if (!row.nudge_sent_at && row.email && inviteAge >= EMAIL_NUDGE_AFTER_MS) return 'email'
  // No in-chat nudge: Photon's shared pool rejects texting a user who has not texted first.
  return null
}

export function chatNudgeText(name: string | null, token: string): string {
  const first = (name ?? '').trim().split(/\s+/)[0]
  return `${first ? `${first}, ` : ''}still here when you are. One tap connects Google and I'll have a first look at your day waiting. Or just send me one real thing you'd like off your plate. ${startLink(token)}`
}

export function nudgeEmail(name: string | null, token: string): { subject: string; text: string } {
  const first = (name ?? '').trim().split(/\s+/)[0]
  return {
    subject: 'Your Dinghy line is waiting',
    text: [
      first ? `Hey ${first},` : 'Hey there,',
      '',
      'Your seat is still open. Connect Google first and I will have a first look at your calendar and inbox ready, headers only, never message bodies. Or text me one real thing you would like off your plate.',
      '',
      startLink(token),
      '',
      '- Dinghy',
    ].join('\n'),
  }
}
