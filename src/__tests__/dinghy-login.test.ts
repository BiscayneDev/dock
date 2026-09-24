import { describe, it, expect, vi, beforeEach } from 'vitest'

const state: {
  identities: Array<{ chat_guid: string; user_id: string | null }>
  allow: Set<string>
  rpc: ReturnType<typeof vi.fn<(...args: unknown[]) => unknown>>
} = { identities: [], allow: new Set(), rpc: vi.fn<(...args: unknown[]) => unknown>() }

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({
    from: (table: string) => {
      const q: Record<string, unknown> = {}
      let key = ''
      q.select = () => q
      q.eq = (_c: string, v: string) => { key = v; return q }
      q.order = async () => ({ data: table === 'spectrum_identities' ? state.identities : [] })
      q.maybeSingle = async () => ({ data: table === 'beta_allowlist' && state.allow.has(key) ? { chat_guid: key } : null })
      return q
    },
    rpc: (...args: unknown[]) => state.rpc(...args),
  }),
}))

import { normalizePhone, hashLoginCode, loginCodeText, startLogin, verifyLogin } from '@/lib/auth/dinghy-login'

beforeEach(() => {
  state.identities = []
  state.allow = new Set()
  state.rpc = vi.fn<(...args: unknown[]) => unknown>()
})

describe('normalizePhone', () => {
  it('normalizes US numbers to E.164', () => {
    expect(normalizePhone('(305) 555-0142')).toBe('+13055550142')
    expect(normalizePhone('1 305 555 0142')).toBe('+13055550142')
    expect(normalizePhone('+44 20 7946 0958')).toBe('+442079460958')
  })
  it('rejects junk', () => {
    expect(normalizePhone('hello')).toBeNull()
    expect(normalizePhone('555-0142')).toBeNull()
    expect(normalizePhone('+1')).toBeNull()
  })
})

describe('login codes', () => {
  it('hash is stable, phone-scoped, and never the raw code', () => {
    const h = hashLoginCode('+13055550142', '123456')
    expect(h).toBe(hashLoginCode('+13055550142', '123 456'))
    expect(h).not.toBe(hashLoginCode('+13055550143', '123456'))
    expect(h).not.toContain('123456')
  })
  it('text carries the code and the expiry', () => {
    expect(loginCodeText('042113')).toMatch(/^042113 is your dinghy sign-in code/)
    expect(loginCodeText('042113')).toContain('10 minutes')
  })
})

describe('startLogin', () => {
  it('sends nothing to numbers without a Dinghy thread', async () => {
    const send = vi.fn()
    expect(await startLogin('+13055550142', send)).toEqual({ sent: false })
    expect(send).not.toHaveBeenCalled()
    expect(state.rpc).not.toHaveBeenCalled()
  })
  it('sends nothing to a thread that is neither bound nor allowlisted', async () => {
    state.identities = [{ chat_guid: 'c1', user_id: null }]
    const send = vi.fn()
    expect(await startLogin('+13055550142', send)).toEqual({ sent: false })
    expect(send).not.toHaveBeenCalled()
  })
  it('texts a 6-digit code into the allowlisted thread and stores only a hash', async () => {
    state.identities = [{ chat_guid: 'c1', user_id: null }]
    state.allow.add('c1')
    state.rpc.mockResolvedValue({ data: true, error: null })
    const send = vi.fn().mockResolvedValue(undefined)
    expect(await startLogin('+13055550142', send)).toEqual({ sent: true })
    const [chat, text] = send.mock.calls[0]
    expect(chat).toBe('c1')
    const code = String(text).slice(0, 6)
    expect(code).toMatch(/^\d{6}$/)
    const [fn, args] = state.rpc.mock.calls[0] as [string, Record<string, string>]
    expect(fn).toBe('dinghy_login_code_create')
    expect(args.p_code_hash).toBe(hashLoginCode('+13055550142', code))
    expect(JSON.stringify(args)).not.toContain(`"${code}"`)
  })
  it('prefers the bound thread and respects the rate limit', async () => {
    state.identities = [{ chat_guid: 'c2', user_id: null }, { chat_guid: 'c1', user_id: 'u1' }]
    state.rpc.mockResolvedValue({ data: false, error: null })
    const send = vi.fn()
    expect(await startLogin('+13055550142', send)).toEqual({ sent: false, limited: true })
    expect((state.rpc.mock.calls[0][1] as Record<string, string>).p_chat_guid).toBe('c1')
    expect(send).not.toHaveBeenCalled()
  })
})

describe('verifyLogin', () => {
  it('rejects malformed codes without a lookup', async () => {
    expect(await verifyLogin('+13055550142', '12ab')).toBeNull()
    expect(state.rpc).not.toHaveBeenCalled()
  })
  it('returns the chat on a good code, null on a bad one', async () => {
    state.rpc.mockResolvedValueOnce({ data: 'c1', error: null }).mockResolvedValueOnce({ data: null, error: null })
    expect(await verifyLogin('+13055550142', '123456')).toBe('c1')
    expect(await verifyLogin('+13055550142', '654321')).toBeNull()
    expect(state.rpc.mock.calls[0][1]).toEqual({ p_phone: '+13055550142', p_code_hash: hashLoginCode('+13055550142', '123456') })
  })
})

describe('Dinghy knows its own site', () => {
  it('names getdinghy.sh in every prompt', async () => {
    const { buildSystemPrompt } = await import('@/lib/spectrum/dinghy')
    expect(buildSystemPrompt([], false)).toContain('getdinghy.sh')
    expect(buildSystemPrompt([], false, { google: true, wallet: false, live: true, search: true })).toContain("don't web_search for it")
  })
})
