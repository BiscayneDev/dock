import { beforeEach, describe, expect, it, vi } from 'vitest'

const { session, calls, state, revoke } = vi.hoisted(() => ({
    session: vi.fn(),
    calls: [] as unknown[][],
    state: { rows: [] as unknown[], single: null as unknown },
    revoke: vi.fn(),
}))
vi.mock('@/lib/auth/session', () => ({ getSession: session }))
vi.mock('@/lib/integrations/revoke', () => ({ revokeGoogleToken: revoke }))
vi.mock('@/lib/crypto', () => ({ decryptTokenFromDb: (s: string) => `plain-${s}`, encryptTokenForDb: (s: string) => s }))
const chain: Record<string, unknown> = {}
vi.mock('@/lib/supabase/server', () => ({
    createServerClient: () => ({ from: (t: string) => { calls.push(['from', t]); return chain }, rpc: async () => ({ data: true, error: null }) }),
}))

import { listConnections, specFor } from '@/lib/profile/connections'
import { disconnectConnection } from '@/lib/profile/disconnect'
import { sameOrigin } from '@/lib/auth/same-origin'
import { POST as disconnectPost } from '@/app/api/integrations/disconnect/route'
import { POST as revokePost } from '@/app/api/user/capabilities/revoke/route'
import { NextRequest } from 'next/server'

beforeEach(() => {
    session.mockReset(); revoke.mockReset(); calls.length = 0; state.rows = []; state.single = null
    for (const m of ['select', 'eq', 'is', 'gt', 'gte', 'order', 'limit', 'like', 'update', 'delete']) chain[m] = (...a: unknown[]) => { calls.push([m, ...a]); return chain }
    chain.maybeSingle = async () => ({ data: state.single, error: null })
    chain.then = (res: (r: unknown) => unknown) => Promise.resolve(res({ data: state.rows, error: null }))
})

const post = (path: string, fields: Record<string, string>, origin: string | null) => {
    const body = new URLSearchParams(fields)
    return new NextRequest(`https://www.getdinghy.sh${path}`, { method: 'POST', body, headers: { 'content-type': 'application/x-www-form-urlencoded', ...(origin ? { origin } : {}) } })
}

describe('connections read model', () => {
    it('filters every query by owner and never selects token columns', async () => {
        await listConnections('owner')
        const eqs = calls.filter((c) => c[0] === 'eq' && c[1] === 'user_id')
        expect(eqs.length).toBe(3)
        for (const c of calls.filter((c) => c[0] === 'select')) {
            expect(String(c[1])).not.toMatch(/access_token|refresh_token|secret_enc/)
        }
    })
    it('describes Google scopes in plain words', () => {
        const can = specFor('google:a@b.com')!.can(['https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/calendar.readonly'])
        expect(can).toEqual(['Read your email', 'Read your calendar'])
    })
    it('ignores providers it does not know', async () => {
        state.rows = [{ provider: 'mystery', scopes: [], provider_account_email: null, provider_account_id: null, created_at: null }]
        expect((await listConnections('owner')).accounts).toEqual([])
    })
})

describe('disconnect', () => {
    it('refuses unknown providers without touching the database', async () => {
        expect(await disconnectConnection('owner', 'evil')).toBeNull()
        expect(calls).toEqual([])
    })
    it('returns null when the user does not own that connection', async () => {
        state.single = null
        expect(await disconnectConnection('owner', 'github')).toBeNull()
        expect(calls).toContainEqual(['eq', 'user_id', 'owner'])
        expect(calls.find((c) => c[0] === 'delete')).toBeUndefined()
    })
    it('deletes a non-Google connection scoped to owner and provider', async () => {
        state.single = { provider: 'github', provider_account_email: null }
        const out = await disconnectConnection('owner', 'github')
        expect(out).toMatchObject({ ok: true, revokedAtProvider: false })
        expect(calls).toContainEqual(['delete'])
        expect(calls).toContainEqual(['eq', 'provider', 'github'])
    })
})

describe('routes', () => {
    it('rejects anonymous and cross-origin posts', async () => {
        session.mockResolvedValue(null)
        expect((await disconnectPost(post('/api/integrations/disconnect', { provider: 'github' }, 'https://www.getdinghy.sh'))).status).toBe(401)
        session.mockResolvedValue({ userId: 'owner' })
        expect((await disconnectPost(post('/api/integrations/disconnect', { provider: 'github' }, 'https://evil.example'))).status).toBe(403)
        expect((await disconnectPost(post('/api/integrations/disconnect', { provider: 'github' }, null))).status).toBe(403)
        expect((await revokePost(post('/api/user/capabilities/revoke', { id: 'x' }, 'https://evil.example'))).status).toBe(403)
        expect(calls).toEqual([])
    })
    it('accepts the app origin', () => {
        expect(sameOrigin(post('/x', {}, 'https://www.getdinghy.sh'))).toBe(true)
    })
    it('rejects a malformed capability id before the database', async () => {
        session.mockResolvedValue({ userId: 'owner' })
        const res = await revokePost(post('/api/user/capabilities/revoke', { id: 'not-a-uuid' }, 'https://www.getdinghy.sh'))
        expect(res.status).toBe(303)
        expect(res.headers.get('location')).toContain('revoke=invalid')
        expect(calls).toEqual([])
    })
})
