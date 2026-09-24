import { describe, it, expect, vi } from 'vitest'
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => ({}) }))
import { buildWaitlistInvite, inviteTextBody, smsLink } from '@/lib/email/waitlist-invite'
import { parseWaitlistInviteCommand, introText, chatGuidForPhone } from '@/lib/spectrum/waitlist-invites'
import { phoneFromChatGuid } from '@/lib/spectrum/line-for-chat'
import { prettyPhone } from '@/lib/spectrum/photon-users'
import { parseInviteCommand } from '@/lib/spectrum/beta-gate'

describe('waitlist invite email', () => {
  it('prefills a text with first name, no code', () => {
    expect(inviteTextBody('Ada Lovelace')).toBe("hey dinghy, it's ada")
    expect(smsLink('+16286293507', 'Ada')).toMatch(/^sms:\+16286293507\?&body=hey%20dinghy/)
  })
  it('carries their own line and no code', () => {
    const { subject, text, html } = buildWaitlistInvite('Ada', '+16286293507')
    expect(subject).toContain('seat')
    expect(text).toContain('no code needed')
    expect(text).not.toMatch(/[A-Z2-9]{4}-[A-Z2-9]{4}/)
    expect(text).toContain('sms:+16286293507')
    expect(text).toContain('(628) 629-3507')
    expect(html).toContain('(628) 629-3507')
    expect(text).not.toContain('264-7754')
    expect(html).toContain('text dinghy')
  })
})

describe('photon onboarding helpers', () => {
  it('formats the assigned line', () => {
    expect(prettyPhone('+16286293507')).toBe('(628) 629-3507')
    expect(prettyPhone('+447700900123')).toBe('+447700900123')
  })
  it('writes the intro in dinghy voice, no code', () => {
    expect(introText('Adam Lee')).toBe("ahoy adam - it's dinghy. you're aboard. save this number and text me whatever you need.")
    expect(introText('')).toMatch(/^ahoy - it's dinghy/)
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
