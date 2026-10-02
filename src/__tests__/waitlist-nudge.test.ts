import { describe, expect, it } from 'vitest'
import { chatNudgeText, inQuietHours, nudgeDue, nudgeEmail, nudgeEnabled, type NudgeRow } from '@/lib/spectrum/waitlist-nudge'

const base: NudgeRow = { status: 'invited', first_text_at: null, intro_texted_at: '2026-10-01T14:00:00Z', invite_sent_at: '2026-10-01T14:00:00Z', chat_nudge_sent_at: null, nudge_sent_at: null, phone: '+16784680733', email: 'a@b.co', dinghy_line: '+15550001111', start_token: 'x'.repeat(32) }
const at = (s: string) => new Date(s)

describe('waitlist nudges', () => {
  it('chat nudge after 4h in daytime, once', () => {
    expect(nudgeDue(base, at('2026-10-01T17:00:00Z'))).toBeNull() // 3h
    expect(nudgeDue(base, at('2026-10-01T18:30:00Z'))).toBe('chat') // 4.5h, 2:30pm ET
    expect(nudgeDue({ ...base, chat_nudge_sent_at: 'x' }, at('2026-10-01T18:30:00Z'))).toBeNull()
  })
  it('holds the chat nudge overnight', () => {
    expect(inQuietHours(at('2026-10-02T04:00:00Z'))).toBe(true) // midnight ET
    expect(nudgeDue(base, at('2026-10-02T04:00:00Z'))).toBeNull()
  })
  it('email at 36h, once, even if the chat nudge went', () => {
    const t = at('2026-10-03T02:30:00Z')
    expect(nudgeDue({ ...base, chat_nudge_sent_at: 'x' }, t)).toBe('email')
    expect(nudgeDue({ ...base, nudge_sent_at: 'x' }, t)).toBeNull()
  })
  it('never for people who texted or are not invited', () => {
    expect(nudgeDue({ ...base, first_text_at: '2026-10-01T15:00:00Z' }, at('2026-10-03T02:30:00Z'))).toBeNull()
    expect(nudgeDue({ ...base, status: 'active' }, at('2026-10-03T02:30:00Z'))).toBeNull()
  })
  it('off unless enabled, plain copy', () => {
    expect(nudgeEnabled({})).toBe(false)
    expect(nudgeEnabled({ DINGHY_WAITLIST_NUDGE: 'on' })).toBe(true)
    for (const t of [chatNudgeText('Ann Lee', 'tok'), nudgeEmail('Ann', 'tok').text]) expect(t).not.toMatch(/[*_`#—]|can't|cannot/i)
    expect(chatNudgeText('Ann Lee', 'tok')).toContain('Ann, still here')
  })
})
