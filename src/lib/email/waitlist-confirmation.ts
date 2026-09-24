// Waitlist confirmation email, sent through Resend's HTTP API (no SDK dependency).
// Fail-soft: a missing key or a Resend error never blocks the signup.

import { maskPhone } from '@/lib/waitlist'

const RESEND_URL = 'https://api.resend.com/emails'
const DEFAULT_FROM = 'Dinghy <hi@getdinghy.sh>'

export interface ConfirmationInput {
  email: string
  name: string
  phone: string
}

export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? ''
}

export function buildWaitlistConfirmation({ name, phone }: ConfirmationInput) {
  const first = firstName(name).toLowerCase()
  const masked = maskPhone(phone)
  const subject = "you're on the dinghy waitlist"
  const text = [
    `hey ${first} - you're on the list.`,
    '',
    `when a seat opens, i'll text you at ${masked} from my own number. save it when it lands so you know it's me.`,
    '',
    'nothing to do until then.',
    '',
    '- dinghy',
    'https://getdinghy.sh',
  ].join('\n')
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const html = `<!doctype html><html><body style="margin:0;padding:32px 20px;background:#F6EFE4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#0B1224;">
<div style="max-width:480px;margin:0 auto;font-size:16px;line-height:1.55;">
<p style="margin:0 0 16px;">hey ${esc(first)} - you're on the list.</p>
<p style="margin:0 0 16px;">when a seat opens, i'll text you at <strong>${esc(masked)}</strong> from my own number. save it when it lands so you know it's me.</p>
<p style="margin:0 0 24px;">nothing to do until then.</p>
<p style="margin:0;">- dinghy<br><a href="https://getdinghy.sh" style="color:#C8653F;">getdinghy.sh</a></p>
</div></body></html>`
  return { subject, text, html }
}

/** Returns true when Resend accepted the email. */
export async function sendWaitlistConfirmation(input: ConfirmationInput): Promise<boolean> {
  const key = process.env.RESEND_API_KEY
  if (!key) return false
  const { subject, text, html } = buildWaitlistConfirmation(input)
  try {
    const res = await fetch(RESEND_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: process.env.WAITLIST_FROM_EMAIL || DEFAULT_FROM,
        to: [input.email],
        reply_to: process.env.WAITLIST_REPLY_TO || undefined,
        subject,
        text,
        html,
      }),
    })
    if (!res.ok) {
      console.error('Waitlist confirmation email failed:', res.status)
      return false
    }
    return true
  } catch (err) {
    console.error('Waitlist confirmation email error:', err instanceof Error ? err.message : 'unknown')
    return false
  }
}
