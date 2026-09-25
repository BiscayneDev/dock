// "Your seat's open" email: the person's own Dinghy number plus a tap-to-text
// HTTPS start link to it. They're already on the allowlist (their registered number is the
// proof), so there's no code - any first text gets them started.
// On Photon's shared pool every user gets their own assigned number, so the
// line always comes from their Photon registration - never one shared number.

import { startLink } from '@/lib/spectrum/start-link'
import { prettyPhone } from '@/lib/spectrum/photon-users'
const RESEND_URL = 'https://api.resend.com/emails'
const DEFAULT_FROM = 'Dinghy <hi@getdinghy.sh>'

export function buildWaitlistInvite(name: string, line: string, token: string) {
  const first = name.trim().split(/\s+/)[0] ?? ''
  const greeting = first ? `Hey ${first},` : 'Hey there,'
  const link = startLink(token)
  const pretty = prettyPhone(line)
  const subject = "You're in the Dinghy beta"
  const text = [
    greeting,
    '',
    `You're in. Your personal Dinghy line is ${pretty} - text it from the phone you signed up with and you can put me to work.`,
    '',
    'Open this on the phone you signed up with. A first request is ready to edit:',
    link,
    '',
    'No code or setup. Edit the message or send it as is.',
    '',
    '- Dinghy',
  ].join('\n')
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  const html = `<!doctype html><html><body style="margin:0;padding:32px 20px;background:#F6EFE4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#0B1224;">
<div style="max-width:480px;margin:0 auto;font-size:16px;line-height:1.55;">
<p style="margin:0 0 16px;">${esc(greeting)}</p>
<p style="margin:0 0 24px;">You're in. Your personal Dinghy line is <strong>${pretty}</strong> - text it from the phone you signed up with and you can put me to work.</p>
<p style="margin:0 0 12px;">Open this on the phone you signed up with. A first request is ready to edit:</p>
<p style="margin:0 0 24px;"><a href="${esc(link)}" style="display:inline-block;background:#0B1224;color:#F6EFE4;text-decoration:none;padding:14px 26px;border-radius:999px;font-weight:600;">Text Dinghy</a></p>
<p style="margin:0 0 24px;">No code or setup. Edit the message or send it as is.</p>
<p style="margin:0;">- Dinghy</p>
</div></body></html>`
  return { subject, text, html }
}

export async function sendWaitlistInvite(email: string, name: string, line: string, token: string): Promise<boolean> {
  const key = process.env.RESEND_API_KEY
  if (!key) return false
  const { subject, text, html } = buildWaitlistInvite(name, line, token)
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
