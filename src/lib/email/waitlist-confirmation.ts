// Waitlist confirmation email, sent through Resend's HTTP API (no SDK dependency).
// Fail-soft: a missing key or a Resend error never blocks the signup.

const RESEND_URL = 'https://api.resend.com/emails'
const DEFAULT_FROM = 'Dinghy <hi@getdinghy.sh>'

export interface ConfirmationInput {
  email: string
  name: string
  phone?: string | null
}

export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? ''
}

export function buildWaitlistConfirmation({ name }: ConfirmationInput) {
  const first = firstName(name)
  const greeting = first ? `Hey ${first},` : 'Hey there,'
  const subject = "You're on the Dinghy waitlist"
  const text = [
    greeting,
    '',
    "You're on the list. When a spot opens, you'll get an email with your personal Dinghy line and a link to start texting.",
    '',
    'Nothing to do until then.',
    '',
    '- Dinghy',
    'https://getdinghy.sh',
  ].join('\n')
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const html = `<!doctype html><html><body style="margin:0;padding:32px 20px;background:#F6EFE4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#0B1224;">
<div style="max-width:480px;margin:0 auto;font-size:16px;line-height:1.55;">
<p style="margin:0 0 16px;">${esc(greeting)}</p>
<p style="margin:0 0 16px;">You're on the list. When a spot opens, you'll get an email with your personal Dinghy line and a link to start texting.</p>
<p style="margin:0 0 24px;">Nothing to do until then.</p>
<p style="margin:0;">- Dinghy<br><a href="https://getdinghy.sh" style="color:#C8653F;">getdinghy.sh</a></p>
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
