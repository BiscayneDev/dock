import { describe, expect, it, vi, beforeEach } from 'vitest'

const state = vi.hoisted(() => ({ inv: { uses: 0, max_uses: 1, expires_at: '2999-01-01' } as unknown, allowed: null as unknown, existing: [] as unknown[], inserted: null as unknown, updated: null as unknown, lookupError: null as unknown, saveRows: [{id:'saved'}], user: { id: 'pu1', phoneNumber: '+16505550101', assignedPhoneNumber: '+16286297000' } as unknown, redeem: 'ok' }))
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({ from: (t: string) => {
    const write = { eq: () => write, is: () => write, select: async () => ({ data: state.saveRows, error: null }) }
    const read = { eq: () => read, maybeSingle: async () => ({ data: t === 'beta_invites' ? state.inv : state.allowed, error: null }), limit: async () => ({ data: state.existing, error: state.lookupError }) }
    return { select: () => read, insert: (row: unknown) => { state.inserted = row; return write }, update: (row: unknown) => { state.updated = row; return write } }
  } }),
}))
vi.mock('@/lib/spectrum/photon-users', () => ({ registerPhotonUser: vi.fn(async () => state.user), prettyPhone: (s: string) => s }))
vi.mock('@/lib/spectrum/beta-gate', () => ({ hashInviteCode: (c: string) => c, redeemInvite: vi.fn(async () => state.redeem) }))
vi.mock('@/lib/spectrum/provision', () => ({ provisionSpectrumIdentity: vi.fn(async () => null) }))
vi.mock('@/lib/spectrum/waitlist-invites', () => ({ chatGuidForPhone: (p: string) => `any;-;${p}` }))

import { claimInvite, normalizePhone, cleanName } from '@/lib/spectrum/invite-claim'

describe('invite claim', () => {
  beforeEach(() => { state.inv = { uses: 0, max_uses: 1, expires_at: '2999-01-01' }; state.allowed = null; state.user = { id: 'pu1', phoneNumber: '+16505550101', assignedPhoneNumber: '+16286297000' }; state.redeem = 'ok'; state.inserted = null; state.updated = null; state.existing = []; state.lookupError = null; state.saveRows = [{id:'saved'}] })
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
  it('reuses an unadmitted joined row without copying its email or name', async () => {
    state.existing = [{ id: 'waiting', status: 'joined', start_token: null, photon_user_id: null, dinghy_line: null }]
    expect((await claimInvite('ABCD-2345', '6505550101', 'Other')).ok).toBe(true)
    expect(state.inserted).toBeNull()
    expect(state.updated).toMatchObject({ status: 'invited', dinghy_line: '+16286297000' })
    expect(state.updated).not.toHaveProperty('email')
    expect(state.updated).not.toHaveProperty('name')
  })
  it.each(['invited', 'active', 'unknown'])('refuses a %s row', async (status) => {
    state.existing = [{ id: 'seat', status }]
    expect(await claimInvite('ABCD-2345', '6505550101', '')).toEqual({ ok: false, reason: 'has_seat' })
  })
  it.each(['start_token', 'photon_user_id', 'dinghy_line'])('refuses a partially provisioned row with %s', async (field) => {
    state.existing = [{ id: 'seat', status: 'joined', [field]: 'existing' }]
    expect(await claimInvite('ABCD-2345', '6505550101', '')).toEqual({ ok: false, reason: 'has_seat' })
  })
  it('fails closed on multiple matching rows or a lookup error', async () => {
    state.existing = [{id:'one'}, {id:'two'}]
    expect(await claimInvite('ABCD-2345', '6505550101', '')).toEqual({ ok: false, reason: 'try_again' })
    state.existing = []; state.lookupError = {message:'db error'}
    expect(await claimInvite('ABCD-2345', '6505550101', '')).toEqual({ ok: false, reason: 'try_again' })
  })
  it('does not return a token when the conditional row update loses a race', async () => {
    state.existing = [{ id: 'waiting', status: 'joined' }]; state.saveRows = []
    expect(await claimInvite('ABCD-2345', '6505550101', '')).toEqual({ ok: false, reason: 'try_again' })
  })

})
