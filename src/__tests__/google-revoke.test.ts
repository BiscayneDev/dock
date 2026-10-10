import { afterEach, describe, expect, it, vi } from 'vitest'
import { revokeGoogleToken } from '@/lib/integrations/revoke'

afterEach(() => vi.unstubAllGlobals())

describe('revokeGoogleToken', () => {
    it('posts the token to Google revoke', async () => {
        const f = vi.fn(async () => new Response('', { status: 200 }))
        vi.stubGlobal('fetch', f)
        expect(await revokeGoogleToken('tok')).toBe('revoked')
        const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]
        expect(url).toBe('https://oauth2.googleapis.com/revoke')
        expect(String(init.body)).toBe('token=tok')
    })
    it('treats an already-invalid token as revoked, other errors as failed', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'invalid_token' }), { status: 400 })))
        expect(await revokeGoogleToken('tok')).toBe('revoked')
        vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 500 })))
        expect(await revokeGoogleToken('tok')).toBe('failed')
        vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('net') }))
        expect(await revokeGoogleToken('tok')).toBe('failed')
        expect(await revokeGoogleToken(null)).toBe('failed')
    })
})
