// "Your seat's open" email: a single-use invite code plus a tap-to-text link
// to Dinghy's line, prefilled so the first text passes the beta gate.

import { firstName } from './waitlist-confirmation'

/** The Dinghy iMessage line (same as spectrum/contact-card DINGHY_PHONE). */
export const DINGHY_LINE = '+16282647754'
const DINGHY_LINE_PRETTY = '(628) 264-7754'
const RESEND_URL = 'https://api.resend.com/emails'
const DEFAULT_FROM = 'Dinghy <hi@getdinghy.sh>'

export function inviteTextBody(name: string, code: string): string {
  const first = firstName(name).toLowerCase()
  return first ? `hey dinghy, it's ${first} - my code is ${code}` : `hey dinghy - my code is ${code}`
}

/** sms: link that works on iOS and Android ("?&body=" is the cross-platform form). */
export function smsLink(name: string, code: string): string {
  return `sms:${DINGHY_LINE}?&body=${encodeURIComponent(inviteTextBody(name, code))}`
}

export function buildWaitlistInvite(name: string, code: string) {
  const first = firstName(name).toLowerCase()
  const link = smsLink(name, code)
  const subject = "your dinghy seat is open"
  const text = [
    `hey ${first} - your seat's open.`,
    '',
    "i live in your texts, so this is the whole signup: tap the link on your phone and send the text that pops up.",
    '',
    link,
    '',
    `or text ${DINGHY_LINE_PRETTY} yourself with your code: ${code}`,
    '',
    "the code works once and expires in 30 days. see you in there.",
    '',
    '- dinghy',
  ].join('\n')
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  const html = `<!doctype html><html><body style="margin:0;padding:32px 20px;background:#F6EFE4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#0B1224;">
<div style="max-width:480px;margin:0 auto;font-size:16px;line-height:1.55;">
<p style="margin:0 0 16px;">hey ${esc(first)} - your seat's open.</p>
<p style="margin:0 0 24px;">i live in your texts, so this is the whole signup: tap the button on your phone and send the text that pops up.</p>
<p style="margin:0 0 24px;"><a href="${esc(link)}" style="display:inline-block;background:#0B1224;color:#F6EFE4;text-decoration:none;padding:14px 26px;border-radius:999px;font-weight:600;">text dinghy</a></p>
<p style="margin:0 0 16px;font-size:14px;color:#4A5268;">or text <strong>${DINGHY_LINE_PRETTY}</strong> yourself with your code: <strong style="letter-spacing:1px;">${esc(code)}</strong></p>
<p style="margin:0 0 24px;font-size:14px;color:#4A5268;">the code works once and expires in 30 days. see you in there.</p>
<p style="margin:0;">- dinghy</p>
</div></body></html>`
  return { subject, text, html }
}

export async function sendWaitlistInvite(email: string, name: string, code: string): Promise<boolean> {
  const key = process.env.RESEND_API_KEY
  if (!key) return false
  const { subject, text, html } = buildWaitlistInvite(name, code)
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
