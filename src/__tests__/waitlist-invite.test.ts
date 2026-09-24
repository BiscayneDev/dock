import { describe, it, expect, vi } from 'vitest'
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => ({}) }))
import { buildWaitlistInvite, inviteTextBody, smsLink } from '@/lib/email/waitlist-invite'
import { parseWaitlistInviteCommand } from '@/lib/spectrum/waitlist-invites'
import { parseInviteCommand } from '@/lib/spectrum/beta-gate'

describe('waitlist invite email', () => {
  it('prefills a text with first name and code', () => {
    expect(inviteTextBody('Ada Lovelace', 'ABCD-EFGH')).toBe("hey dinghy, it's ada - my code is ABCD-EFGH")
    expect(smsLink('Ada', 'ABCD-EFGH')).toMatch(/^sms:\+16282647754\?&body=hey%20dinghy/)
  })
  it('includes the code and link in both parts', () => {
    const { subject, text, html } = buildWaitlistInvite('Ada', 'ABCD-EFGH')
    expect(subject).toContain('seat')
    expect(text).toContain('ABCD-EFGH')
    expect(text).toContain('sms:+16282647754')
    expect(html).toContain('text dinghy')
    expect(html).toContain('ABCD-EFGH')
  })
})

describe('owner invite commands', () => {
  it('parses next N and email', () => {
    expect(parseWaitlistInviteCommand('invite next 5')).toEqual({ kind: 'next', count: 5 })
    expect(parseWaitlistInviteCommand('Invite the next 100')).toEqual({ kind: 'next', count: 25 })
    expect(parseWaitlistInviteCommand('invite Ada@Example.com')).toEqual({ kind: 'email', email: 'ada@example.com' })
    expect(parseWaitlistInviteCommand('invite 5')).toBeNull()
    expect(parseWaitlistInviteCommand('invite')).toBeNull()
  })
  it('does not collide with code minting', () => {
    expect(parseInviteCommand('invite next 5')).toBeNull()
    expect(parseInviteCommand('invite 5')).toBe(5)
  })
})
