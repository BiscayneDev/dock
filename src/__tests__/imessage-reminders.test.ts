import { describe, it, expect, vi, beforeEach } from 'vitest'

const rpc = vi.fn()
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => ({ rpc }) }))

import { localToUtc, resolveFireAt, reminderToolsFor, formatLocal, validTimezone, reminderText } from '@/lib/spectrum/reminders'
import { buildSystemPrompt } from '@/lib/spectrum/dinghy'

const ctx = { userId: '', telegramId: 0, telegramChatId: 0, name: '', timezone: 'America/New_York', tokens: {} }
// Wed Sep 23 2026, 2:42 PM EDT
const NOW = new Date('2026-09-23T18:42:00Z')

beforeEach(() => rpc.mockReset())

describe('time handling', () => {
  it('reads a local wall-clock time in the chat timezone', () => {
    expect(localToUtc('2026-09-23T17:00', 'America/New_York')?.toISOString()).toBe('2026-09-23T21:00:00.000Z')
    expect(localToUtc('2026-09-23T17:00', 'America/Los_Angeles')?.toISOString()).toBe('2026-09-24T00:00:00.000Z')
    // After DST ends (Nov 1 2026) New York is UTC-5.
    expect(localToUtc('2026-11-02T09:30', 'America/New_York')?.toISOString()).toBe('2026-11-02T14:30:00.000Z')
  })

  it('honours explicit offsets and relative minutes', () => {
    const a = resolveFireAt({ at: '2026-09-23T21:00:00Z' }, 'America/New_York', NOW)
    expect(a).toEqual(new Date('2026-09-23T21:00:00Z'))
    const b = resolveFireAt({ in_minutes: 20 }, 'America/New_York', NOW)
    expect(b).toEqual(new Date('2026-09-23T19:02:00Z'))
  })

  it('rejects past, unreadable and far-future times', () => {
    expect(resolveFireAt({ at: '2026-09-23T09:00' }, 'America/New_York', NOW)).toHaveProperty('error')
    expect(resolveFireAt({ at: 'at five' }, 'America/New_York', NOW)).toHaveProperty('error')
    expect(resolveFireAt({ at: '2028-01-01T09:00' }, 'America/New_York', NOW)).toHaveProperty('error')
    expect(resolveFireAt({ in_minutes: -5 }, 'America/New_York', NOW)).toHaveProperty('error')
    expect(resolveFireAt({}, 'America/New_York', NOW)).toHaveProperty('error')
  })

  it('falls back to New York for missing or bad timezones', () => {
    expect(validTimezone(undefined)).toBe('America/New_York')
    expect(validTimezone('Not/AZone')).toBe('America/New_York')
    expect(validTimezone('Europe/Lisbon')).toBe('Europe/Lisbon')
  })

  it('formats in the chat timezone', () => {
    expect(formatLocal(new Date('2026-09-23T21:00:00Z'), 'America/New_York')).toBe('Wed, Sep 23, 5:00 PM')
  })
})

describe('reminder tools', () => {
  const tools = () => reminderToolsFor('chat-1', null, 'America/New_York', () => NOW)
  const byName = (n: string) => tools().find((t) => t.name === n)!

  it('tells the model the current local time', () => {
    expect(byName('reminder_set').description).toContain('2026-09-23T14:42')
  })

  it('sets a reminder for 5pm local, keyed by chat', async () => {
    rpc.mockResolvedValue({ data: { id: 'r1' }, error: null })
    const r = await byName('reminder_set').execute({ message: 'call Pia', at: '2026-09-23T17:00' }, ctx)
    expect(r.success).toBe(true)
    expect(rpc).toHaveBeenCalledWith('dinghy_reminder_create', {
      p_chat_guid: 'chat-1', p_user_id: null, p_message: 'call Pia', p_fire_at: '2026-09-23T21:00:00.000Z',
    })
    expect(r.data).toMatchObject({ when: 'Wed, Sep 23, 5:00 PM' })
  })

  it('does not save when the time is bad', async () => {
    const r = await byName('reminder_set').execute({ message: 'x', at: '2026-09-23T08:00' }, ctx)
    expect(r.success).toBe(false)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('lists and cancels only within this chat', async () => {
    rpc.mockResolvedValueOnce({ data: [{ id: 'r1', message: 'call Pia', fire_at: '2026-09-23T21:00:00Z' }], error: null })
    const l = await byName('reminder_list').execute({}, ctx)
    expect(rpc).toHaveBeenLastCalledWith('dinghy_reminder_list', { p_chat_guid: 'chat-1' })
    expect(l.data).toEqual([{ id: 'r1', message: 'call Pia', when: 'Wed, Sep 23, 5:00 PM' }])

    rpc.mockResolvedValueOnce({ data: false, error: null })
    const id = '11111111-2222-3333-4444-555555555555'
    const c = await byName('reminder_cancel').execute({ id }, ctx)
    expect(rpc).toHaveBeenLastCalledWith('dinghy_reminder_cancel', { p_chat_guid: 'chat-1', p_id: id })
    expect(c.success).toBe(false)
  })

  it('prompt mentions reminders only when offered', () => {
    expect(buildSystemPrompt([], false, { google: false, wallet: false, reminders: true })).toContain('reminder_set')
    expect(buildSystemPrompt([], false, { google: false, wallet: false })).not.toContain('reminder_set')
  })

  it('reminder text is plain', () => {
    expect(reminderText('call Pia')).toBe('Reminder: call Pia')
  })
})
