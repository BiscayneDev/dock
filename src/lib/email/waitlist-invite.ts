// "Your seat's open" email: the person's own Dinghy number plus a tap-to-text
// link to it. They're already on the allowlist (their registered number is the
// proof), so there's no code - any first text gets them started.
// On Photon's shared pool every user gets their own assigned number, so the
// line always comes from their Photon registration - never one shared number.

import { firstName } from './waitlist-confirmation'
import { prettyPhone } from '@/lib/spectrum/photon-users'
const RESEND_URL = 'https://api.resend.com/emails'
const DEFAULT_FROM = 'Dinghy <hi@getdinghy.sh>'

export function inviteTextBody(name: string): string {
  const first = firstName(name).toLowerCase()
  return first ? `hey dinghy, it's ${first}` : 'hey dinghy'
}

/** sms: link that works on iOS and Android ("?&body=" is the cross-platform form). */
export function smsLink(line: string, name: string): string {
  return `sms:${line}?&body=${encodeURIComponent(inviteTextBody(name))}`
}

export function buildWaitlistInvite(name: string, line: string) {
  const first = firstName(name).toLowerCase()
  const link = smsLink(line, name)
  const DINGHY_LINE_PRETTY = prettyPhone(line)
  const subject = "your dinghy seat is open"
  const text = [
    `hey ${first} - your seat's open.`,
    '',
    `i live in your texts. this is your own dinghy number: ${DINGHY_LINE_PRETTY} - save it. you're already aboard - tap the link on your phone and send the text that pops up.`,
    '',
    link,
    '',
    `or just text ${DINGHY_LINE_PRETTY} from the phone you signed up with. no code needed. see you in there.`,
    '',
    '- dinghy',
  ].join('\n')
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  const html = `<!doctype html><html><body style="margin:0;padding:32px 20px;background:#F6EFE4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#0B1224;">
<div style="max-width:480px;margin:0 auto;font-size:16px;line-height:1.55;">
<p style="margin:0 0 16px;">hey ${esc(first)} - your seat's open.</p>
<p style="margin:0 0 24px;">i live in your texts. this is your own dinghy number: <strong>${DINGHY_LINE_PRETTY}</strong> - save it. you're already aboard - tap the button on your phone and send the text that pops up.</p>
<p style="margin:0 0 24px;"><a href="${esc(link)}" style="display:inline-block;background:#0B1224;color:#F6EFE4;text-decoration:none;padding:14px 26px;border-radius:999px;font-weight:600;">text dinghy</a></p>
<p style="margin:0 0 24px;font-size:14px;color:#4A5268;">or just text <strong>${DINGHY_LINE_PRETTY}</strong> from the phone you signed up with. no code needed. see you in there.</p>
<p style="margin:0;">- dinghy</p>
</div></body></html>`
  return { subject, text, html }
}

export async function sendWaitlistInvite(email: string, name: string, line: string): Promise<boolean> {
  const key = process.env.RESEND_API_KEY
  if (!key) return false
  const { subject, text, html } = buildWaitlistInvite(name, line)
  try {
    const res = await fetch(RESEND_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: process.env.WAITLIST_FROM_EMAIL || DEFAULT_FROM, to: [email], subject, text, html }),
    })
    if (!res.ok) console.error('Waitlist invite email failed:', res.status)
    return res.ok
  } catch (err) {
    console.error('Waitlist invite email error:', err instanceof Error ? err.message : 'unknown')
    return false
  }
}
