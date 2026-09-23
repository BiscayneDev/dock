import { describe, it, expect, vi, beforeEach } from 'vitest'

const rpc = vi.fn()
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => ({ rpc }) }))
const store = vi.fn()
vi.mock('@/lib/integrations/paybox', () => ({
    getPayboxAppUrl: () => 'https://app.paybox.sh',
    getPayboxAccessToken: vi.fn(async () => tokenWith({ cid: 'agent_123' })),
    getPayboxSigningKey: vi.fn(async () => null),
    storePayboxSigningKey: (...a: unknown[]) => store(...a),
}))
const enqueue = vi.fn(async () => 'ob1')
vi.mock('@/lib/spectrum/outbox', () => ({ enqueueOutbox: (...a: unknown[]) => enqueue(...a) }))
vi.mock('@paybox-sh/sdk', () => ({
    credsFromToken: (t: string) => {
        if (t !== 'pbxk1.good') throw new Error('bad')
        return { apiPubHex: 'a', apiPrivHex: 'b', savedAt: 0 }
    },
}))

function tokenWith(claims: Record<string, unknown>): string {
    return `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`
}

import { agentCid, agentKeyUrl, checkSigningKey, mintKeySetupLinks, redeemKeyLink, KEY_SAVED_ACK } from '@/lib/integrations/paybox-key-link'

beforeEach(() => {
    rpc.mockReset()
    store.mockReset()
    enqueue.mockClear()
})

describe('agent key url', () => {
    it('reads cid from the access token, not the oauth client id', () => {
        expect(agentCid(tokenWith({ cid: 'agent_123', client_id: 'pbx-oauth-x' }))).toBe('agent_123')
        expect(agentCid(tokenWith({ client_id: 'pbx-oauth-x' }))).toBeNull()
        expect(agentCid('not-a-jwt')).toBeNull()
        expect(agentKeyUrl('agent_123')).toBe('https://app.paybox.sh/agent-key?client_id=agent_123')
    })
})

describe('checkSigningKey', () => {
    it('accepts a valid pbxk1 key and explains bad ones', () => {
        expect(checkSigningKey(' pbxk1.good ')).toBeNull()
        expect(checkSigningKey('pbx_live_abc')).toMatch(/API key/)
        expect(checkSigningKey('hello')).toMatch(/pbxk1/)
        expect(checkSigningKey('pbxk1.bad')).toMatch(/didn't check out/)
        expect(checkSigningKey('')).toMatch(/Paste/)
    })
})

describe('mintKeySetupLinks', () => {
    it('stores only a hash and returns both links', async () => {
        rpc.mockResolvedValue({ error: null })
        const links = await mintKeySetupLinks('u1', {} as never, 'chat1')
        expect(links.generateUrl).toBe('https://app.paybox.sh/agent-key?client_id=agent_123')
        const t = new URL(links.pasteUrl).searchParams.get('t')!
        expect(t.length).toBeGreaterThan(20)
        const [fn, args] = rpc.mock.calls[0]
        expect(fn).toBe('create_paybox_key_link')
        expect(args.p_hash).not.toContain(t)
        expect(args.p_hash).toMatch(/^[0-9a-f]{64}$/)
        expect(args).toMatchObject({ p_user: 'u1', p_chat: 'chat1', p_ttl_seconds: 900 })
    })
})

describe('redeemKeyLink', () => {
    it('rejects a bad key without using the link', async () => {
        const r = await redeemKeyLink('tok', 'pbxk1.bad')
        expect(r.ok).toBe(false)
        expect(rpc).not.toHaveBeenCalled()
    })
    it('rejects an expired or used link', async () => {
        rpc.mockResolvedValue({ data: [], error: null })
        const r = await redeemKeyLink('tok', 'pbxk1.good')
        expect(r).toMatchObject({ ok: false, status: 410 })
        expect(store).not.toHaveBeenCalled()
    })
    it('consumes, stores, and acks in the thread', async () => {
        rpc.mockImplementation(async (fn: string) =>
            fn === 'peek_paybox_key_link'
                ? { data: [{ user_id: 'u1', chat_guid: 'chat1' }], error: null }
                : { data: [{ user_id: 'u1', chat_guid: 'chat1' }], error: null }
        )
        const r = await redeemKeyLink('tok', ' pbxk1.good ')
        expect(r).toEqual({ ok: true })
        expect(rpc.mock.calls.map((c) => c[0])).toEqual(['peek_paybox_key_link', 'consume_paybox_key_link'])
        expect(store).toHaveBeenCalledWith('u1', 'pbxk1.good')
        expect(enqueue).toHaveBeenCalledWith('chat1', 'reply', KEY_SAVED_ACK)
    })
})

describe('approval honesty', () => {
    it('wallet sign under approval says it cannot finish', async () => {
        const { walletSignNeedsApproval, swapApprovalTimedOut } = await import('@/lib/tools/paybox')
        const w = walletSignNeedsApproval('req1')
        expect(w.success).toBe(false)
        expect(w.error).toMatch(/can't yet finish/)
        expect(w.error).toMatch(/do NOT retry or poll/)
        const s = swapApprovalTimedOut('req2')
        expect(s.success).toBe(false)
        expect(s.error).toMatch(/nothing was swapped/)
    })
})
