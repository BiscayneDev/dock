import { describe, expect, it } from 'vitest'
import { buildSystemPrompt } from '@/lib/spectrum/dinghy'
import { denyMessage } from '@/lib/browser-sessions/policy'

describe('capability voice', () => {
  const full = buildSystemPrompt([], false, { google: true, wallet: false, computer: true, reminders: true })

  it('bans "I can\'t" phrasing instead of allowing it as a last resort', () => {
    expect(full).toContain('Never write "I can\'t"')
    expect(full).not.toContain('last resort')
  })

  it('routes Google to the connect link, not browser_connect', () => {
    expect(full).toContain('connect my gmail')
    expect(full).toContain('never goes through browser_connect')
  })

  it('proposes connect for a named kind of account by asking which site', () => {
    expect(full).toContain('ask which site')
  })

  it('has recurring and email-archive guidance', () => {
    expect(full).toContain('Recurring asks')
    expect(full).toContain('exactly one scoping question')
  })

  it('omits the connect line without browser tools', () => {
    const p = buildSystemPrompt([], false, { google: true, wallet: false })
    expect(p).not.toContain('call browser_connect')
  })

  it('denial for Google points at the Google connect link', () => {
    const m = denyMessage('google.com', 'identity')
    expect(m).toContain('connect my gmail')
    expect(m).not.toMatch(/I can't/)
  })

  it('denial for other sites avoids "can\'t" and offers alternatives', () => {
    const m = denyMessage('chase.com', 'financial')
    expect(m).toContain('what does work')
    expect(m).not.toContain("so I can't")
  })
})
