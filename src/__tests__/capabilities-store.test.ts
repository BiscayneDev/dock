import { describe, it, expect, vi, beforeEach } from 'vitest'

const rpc = vi.fn()
const calls: Array<{ table: string; op: string; payload?: unknown; filters: Array<[string, unknown]> }> = []
let selectResult: unknown = null

function builder(table: string) {
  const rec: { table: string; op: string; payload?: unknown; filters: Array<[string, unknown]> } = { table, op: 'select', filters: [] }
  calls.push(rec)
  const b: Record<string, unknown> = {}
  const chain = () => b
  b.update = (p: unknown) => { rec.op = 'update'; rec.payload = p; return b }
  b.insert = (p: unknown) => { rec.op = 'insert'; rec.payload = p; return b }
  b.select = chain
  b.eq = (k: string, v: unknown) => { rec.filters.push([k, v]); return b }
  b.is = (k: string, v: unknown) => { rec.filters.push([k, v]); return b }
  b.gt = chain
  b.order = () => Promise.resolve({ data: selectResult })
  b.single = () => Promise.resolve({ data: { id: 'cap1' }, error: null })
  b.maybeSingle = () => Promise.resolve({ data: selectResult })
  b.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: [{ id: 'x' }], error: null }).then(res)
  return b
}
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => ({ rpc, from: builder }) }))

process.env.ENCRYPTION_KEY = 'a'.repeat(64)

import { mintConnectToken, consumeConnectAttempt, saveCapability, loadCapabilitySecret, revokeCapabilities } from '@/lib/capabilities/store'
import { createHash } from 'crypto'

beforeEach(() => {
  rpc.mockReset()
  calls.length = 0
  selectResult = null
})

describe('connect tokens', () => {
  it('stores only the hash of the token', async () => {
    rpc.mockResolvedValue({ error: null })
    const token = await mintConnectToken('u1', 'chat1', 'browser_session', { site: 'github.com' })
    expect(token.length).toBeGreaterThan(20)
    const [fn, args] = rpc.mock.calls[0]
    expect(fn).toBe('create_capability_connect_attempt')
    expect(args.p_hash).toBe(createHash('sha256').update(token).digest('hex'))
    expect(JSON.stringify(args)).not.toContain(token)
    expect(args.p_params).toEqual({ site: 'github.com' })
  })
  it('consume returns null for a used or expired link', async () => {
    rpc.mockResolvedValue({ data: [], error: null })
    expect(await consumeConnectAttempt('whatever-token')).toBeNull()
    expect(await consumeConnectAttempt('')).toBeNull()
  })
})

describe('saveCapability', () => {
  it('encrypts the secret and revokes the old live row first', async () => {
    const id = await saveCapability({ userId: 'u1', kind: 'browser_session', label: 'github.com', scope: { site: 'github.com' }, secret: { cookies: [{ name: 'sess', value: 'TOPSECRET' }] } })
    expect(id).toBe('cap1')
    const revoke = calls[0]
    expect(revoke.op).toBe('update')
    expect((revoke.payload as { secret_enc: unknown }).secret_enc).toBeNull()
    const insert = calls[1]
    expect(insert.op).toBe('insert')
    const row = insert.payload as { secret_enc: string; mode: string; expires_at: string }
    expect(row.secret_enc).not.toContain('TOPSECRET')
    expect(row.mode).toBe('read')
    expect(new Date(row.expires_at).getTime()).toBeGreaterThan(Date.now() + 29 * 86_400_000)
  })
})

describe('loadCapabilitySecret', () => {
  it('round-trips the secret and never returns secret_enc on the row', async () => {
    await saveCapability({ userId: 'u1', kind: 'browser_session', label: 'github.com', scope: {}, secret: { hello: 'world' } })
    const enc = (calls[1].payload as { secret_enc: string }).secret_enc
    calls.length = 0
    selectResult = { id: 'cap1', user_id: 'u1', kind: 'browser_session', label: 'github.com', scope: {}, mode: 'read', created_at: '', expires_at: '', last_used_at: null, revoked_at: null, secret_enc: enc }
    const out = await loadCapabilitySecret<{ hello: string }>('u1', 'browser_session', 'github.com')
    expect(out?.secret).toEqual({ hello: 'world' })
    expect(out && 'secret_enc' in out.row).toBe(false)
  })
  it('returns null when nothing live matches', async () => {
    selectResult = null
    expect(await loadCapabilitySecret('u1', 'browser_session', 'nope.com')).toBeNull()
  })
})

describe('revokeCapabilities', () => {
  it('wipes the secret and reports how many rows', async () => {
    const n = await revokeCapabilities('u1', 'browser_session', 'github.com')
    expect(n).toBe(1)
    expect((calls[0].payload as { secret_enc: unknown }).secret_enc).toBeNull()
    expect(calls[0].filters).toContainEqual(['label', 'github.com'])
  })
})
