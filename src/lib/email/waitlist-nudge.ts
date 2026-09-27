import { startLink } from '@/lib/spectrum/start-link'
import { prettyPhone } from '@/lib/spectrum/photon-users'

/** Proposed one-time nudge; the scheduler is deliberately not enabled yet. */
export function buildWaitlistNudge(line: string, token: string) {
  const url = startLink(token)
  const subject = 'Your Dinghy line is ready'
  const text = [
    'Your Dinghy line is ready when you are.',
    '',
    `Open this on the phone you signed up with to send your first request: ${url}`,
    '',
    `Or text ${prettyPhone(line)} from that phone. No code needed.`,
    '',
    '- Dinghy',
  ].join('\n')
  const html = `<div style="margin:0;padding:32px 20px;background:#F6EFE4;color:#0B1224;font:16px/1.5 -apple-system,BlinkMacSystemFont,Arial,sans-serif"><div style="max-width:480px;margin:auto"><p>Your Dinghy line is ready when you are.</p><p><a href="${url}" style="display:inline-block;background:#0B1224;color:#F6EFE4;padding:14px 24px;text-decoration:none;border-radius:999px">Text Dinghy</a></p><p>Open on the phone you signed up with, or text ${prettyPhone(line)} from that phone. No code needed.</p><p>- Dinghy</p></div></div>`
  return { subject, text, html }
}
