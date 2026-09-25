import { describe, it, expect, vi } from 'vitest'
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => ({}) }))
import { buildWaitlistInvite } from '@/lib/email/waitlist-invite'
import { FIRST_TASK, startSmsLink, startLink } from '@/lib/spectrum/start-link'
import { parseWaitlistInviteCommand, introText, chatGuidForPhone } from '@/lib/spectrum/waitlist-invites'
import { phoneFromChatGuid } from '@/lib/spectrum/line-for-chat'
import { prettyPhone } from '@/lib/spectrum/photon-users'
import { parseInviteCommand } from '@/lib/spectrum/beta-gate'

describe('waitlist invite email', () => {
  it('prefills a useful task with the assigned line, no code', () => {
    expect(FIRST_TASK).toContain('Find three useful AI stories')
    expect(startSmsLink('+16286293507')).toBe(`sms:+16286293507?&body=${encodeURIComponent(FIRST_TASK)}`)
    expect(startLink('a'.repeat(32))).toBe(`https://www.getdinghy.sh/start/${'a'.repeat(32)}`)
  })
  it('carries their own line and no code', () => {
    const { subject, text, html } = buildWaitlistInvite('Ada', '+16286293507', 'a'.repeat(32))
    expect(subject).toBe("You're in the Dinghy beta")
    expect(text).toContain('Hey Ada,')
    expect(text).toContain('No code or setup.')
    expect(text).not.toMatch(/i live in your texts/i)
    expect(text).not.toMatch(/[A-Z2-9]{4}-[A-Z2-9]{4}/)
    expect(text).toContain(`https://www.getdinghy.sh/start/${'a'.repeat(32)}`)
    expect(text).toContain('(628) 629-3507')
    expect(html).toContain('(628) 629-3507')
    expect(text).not.toContain('264-7754')
    expect(html).toContain('Text Dinghy')
    expect(html).not.toContain('sms:')
  })
})

describe('photon onboarding helpers', () => {
  it('formats the assigned line', () => {
    expect(prettyPhone('+16286293507')).toBe('(628) 629-3507')
    expect(prettyPhone('+447700900123')).toBe('+447700900123')
  })
  it('writes the intro in the Dinghy voice, no code', () => {
    expect(introText('Adam Lee')).toBe("Hi Adam, it's Dinghy. You're in the beta. Save this number and text me whatever you need.")
    expect(introText('')).toMatch(/^Hi, it's Dinghy/)
  })
  it('maps phones to chat guids and back', () => {
    expect(chatGuidForPhone('+16784680733')).toBe('any;-;+16784680733')
    expect(phoneFromChatGuid('any;-;+16784680733')).toBe('+16784680733')
    expect(phoneFromChatGuid('any;-;someone@icloud.com')).toBeNull()
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
