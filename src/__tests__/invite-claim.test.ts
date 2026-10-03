import { describe, expect, it, vi, beforeEach } from 'vitest'

const state = vi.hoisted(() => ({ inv: { uses: 0, max_uses: 1, expires_at: '2999-01-01' } as unknown, allowed: null as unknown, existing: null as unknown, inserted: null as unknown, user: { id: 'pu1', phoneNumber: '+16505550101', assignedPhoneNumber: '+16286297000' } as unknown, redeem: 'ok' }))
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({
    from: (t: string) => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: t === 'beta_invites' ? state.inv : state.allowed, error: null }), limit: () => ({ maybeSingle: async () => ({ data: state.existing, error: null }) }) }),
      }),
      insert: async (row: unknown) => { state.inserted = row; return { error: null } },
    }),
  }),
}))
vi.mock('@/lib/spectrum/photon-users', () => ({ registerPhotonUser: vi.fn(async () => state.user), prettyPhone: (s: string) => s }))
vi.mock('@/lib/spectrum/beta-gate', () => ({ hashInviteCode: (c: string) => c, redeemInvite: vi.fn(async () => state.redeem) }))
vi.mock('@/lib/spectrum/provision', () => ({ provisionSpectrumIdentity: vi.fn(async () => null) }))
vi.mock('@/lib/spectrum/waitlist-invites', () => ({ chatGuidForPhone: (p: string) => `any;-;${p}` }))

import { claimInvite, normalizePhone, cleanName } from '@/lib/spectrum/invite-claim'

describe('invite claim', () => {
  beforeEach(() => { state.inv = { uses: 0, max_uses: 1, expires_at: '2999-01-01' }; state.allowed = null; state.user = { id: 'pu1', phoneNumber: '+16505550101', assignedPhoneNumber: '+16286297000' }; state.redeem = 'ok'; state.inserted = null })
  it('normalizes phones', () => {
    expect(normalizePhone('(650) 555-0101')).toBe('+16505550101')
    expect(normalizePhone('1 650 555 0101')).toBe('+16505550101')
    expect(normalizePhone('+44 7700 900123')).toBe('+447700900123')
    expect(normalizePhone('555')).toBeNull()
    expect(normalizePhone('0505550101')).toBeNull()
  })
  it('cleans names', () => {
    expect(cleanName('  Ana   Maria ')).toBe('Ana Maria')
    expect(cleanName('<script>')).toBeNull()
  })
  it('gives a token and the assigned line on a good claim', async () => {
    const r = await claimInvite('ABCD-2345', '650 555 0101', 'Ana')
    expect(r.ok).toBe(true)
    const row = state.inserted as Record<string, unknown>
    expect(row.phone).toBe('+16505550101')
    expect(row.dinghy_line).toBe('+16286297000')
    expect(row.status).toBe('invited')
    expect(String(row.email)).toMatch(/\.invalid$/)
    expect(String(row.start_token)).toMatch(/^[A-Za-z0-9_-]{32}$/)
  })
  it('rejects bad code, used code, bad phone, and existing seat without a token', async () => {
    expect(await claimInvite('nope', '6505550101', '')).toEqual({ ok: false, reason: 'bad_code' })
    state.inv = { uses: 1, max_uses: 1, expires_at: '2999-01-01' }
    expect(await claimInvite('ABCD-2345', '6505550101', '')).toEqual({ ok: false, reason: 'bad_code' })
    state.inv = { uses: 0, max_uses: 1, expires_at: '2999-01-01' }
    expect(await claimInvite('ABCD-2345', 'abc', '')).toEqual({ ok: false, reason: 'bad_phone' })
    state.allowed = { chat_guid: 'x' }
    expect(await claimInvite('ABCD-2345', '6505550101', '')).toEqual({ ok: false, reason: 'has_seat' })
    expect(state.inserted).toBeNull()
  })
  it('does not burn the code when no line can be assigned', async () => {
    state.user = null
    expect(await claimInvite('ABCD-2345', '6505550101', '')).toEqual({ ok: false, reason: 'no_line' })
    expect(state.inserted).toBeNull()
  })
})
