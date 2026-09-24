import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => ({}) }))

import { googleAccountsOf, resolveAccount, multiAccount, accountsLine, extraGoogleProvider } from '@/lib/integrations/google-accounts'
import { draftAccount, renderProposal } from '@/lib/spectrum/actions'
import { wantsAnotherGoogle } from '@/lib/spectrum/dinghy'
import type { Tool, UserContext } from '@/lib/llm/types'

const tok = (email: string) => ({ accessToken: `at-${email}`, refreshToken: 'rt', expiresAt: null, email })
const one: UserContext = { userId: 'u', telegramId: 0, telegramChatId: 0, name: '', timezone: 'UTC', tokens: { google: tok('halsey.huth@gmail.com') } } as UserContext
const two: UserContext = {
    ...one,
    tokens: { google: tok('halsey.huth@gmail.com'), 'google:halsey@biscayneventures.xyz': tok('halsey@biscayneventures.xyz'), paybox: tok('x') },
} as UserContext

const echo: Tool = {
    name: 'echo',
    description: '',
    inputSchema: { type: 'object', properties: { q: { type: 'string' } } },
    execute: async (input, ctx) => ({ success: true, data: { who: ctx.tokens.google.email, input } }),
}

describe('google accounts', () => {
    it('lists primary first and ignores other providers', () => {
        expect(googleAccountsOf(two).map((a) => [a.email, a.primary])).toEqual([
            ['halsey.huth@gmail.com', true],
            ['halsey@biscayneventures.xyz', false],
        ])
        expect(extraGoogleProvider(' Foo@Bar.com ')).toBe('google:foo@bar.com')
    })

    it('resolves partial names', () => {
        const a = googleAccountsOf(two)
        expect((resolveAccount(a, 'biscayne') as { email: string }).email).toBe('halsey@biscayneventures.xyz')
        expect((resolveAccount(a, 'primary') as { email: string }).email).toBe('halsey.huth@gmail.com')
        expect(resolveAccount(a, 'halsey')).toBe('ambiguous')
        expect(resolveAccount(a, 'nope')).toBeNull()
    })

    it('single account: unchanged behaviour, account param stripped', async () => {
        const r = await multiAccount(echo, 'all').execute({ q: 'x', account: 'whatever' }, one)
        expect(r.data).toEqual({ who: 'halsey.huth@gmail.com', input: { q: 'x' } })
    })

    it("'all' fans out and labels each account", async () => {
        const r = await multiAccount(echo, 'all').execute({ q: 'x' }, two)
        const accts = (r.data as { accounts: { account: string; who: string }[] }).accounts
        expect(accts.map((a) => [a.account, a.who])).toEqual([
            ['halsey.huth@gmail.com', 'halsey.huth@gmail.com'],
            ['halsey@biscayneventures.xyz', 'halsey@biscayneventures.xyz'],
        ])
    })

    it('named account wins; unknown fails closed', async () => {
        const r = await multiAccount(echo, 'primary').execute({ account: 'biscayne' }, two)
        expect((r.data as { who: string }).who).toBe('halsey@biscayneventures.xyz')
        expect((await multiAccount(echo, 'primary').execute({ account: 'nope' }, two)).success).toBe(false)
    })

    it("'find' tries each account until one succeeds", async () => {
        const only: Tool = { ...echo, execute: async (_i, ctx) => (ctx.tokens.google.email === 'halsey@biscayneventures.xyz' ? { success: true, data: { ok: 1 } } : { success: false, error: 'not found' }) }
        const r = await multiAccount(only, 'find').execute({}, two)
        expect(r.data).toEqual({ account: 'halsey@biscayneventures.xyz', ok: 1 })
    })

    it('prompt line only with several accounts', () => {
        expect(accountsLine(one)).toBe('')
        expect(accountsLine(two)).toContain('halsey.huth@gmail.com (primary)')
    })
})

describe('drafts pick an account', () => {
    it('one account: nothing stored', () => {
        expect(draftAccount(one, undefined, 'required')).toEqual({ account: null })
    })
    it('send defaults to primary, reply must name one', () => {
        expect(draftAccount(two, undefined, 'primary').account?.email).toBe('halsey.huth@gmail.com')
        expect(draftAccount(two, undefined, 'required').error).toMatch(/several accounts/)
        expect(draftAccount(two, 'biscayne', 'required').account?.email).toBe('halsey@biscayneventures.xyz')
    })
    it('confirmation shows the sending account', () => {
        const t = renderProposal({ id: '1', kind: 'gmail_send', payload: { to: 'a@b.c', subject: 's', body: 'b', account: 'halsey@biscayneventures.xyz' } })
        expect(t).toContain('from: halsey@biscayneventures.xyz\nto: a@b.c')
        expect(renderProposal({ id: '1', kind: 'gmail_send', payload: { to: 'a@b.c', subject: 's', body: 'b' } })).not.toContain('from:')
        expect(renderProposal({ id: '1', kind: 'google_disconnect', payload: { account: 'x@y.z' } })).toContain('disconnect x@y.z')
    })
})

describe('add-another intent', () => {
    it.each(['connect my other gmail', 'can you add my work email', 'link a second google account', 'add another inbox'])('matches %s', (t) => {
        expect(wantsAnotherGoogle(t)).toBe(true)
    })
    it.each(['check my email', 'what is on my calendar', 'send another email to sam'])('ignores %s', (t) => {
        expect(wantsAnotherGoogle(t)).toBe(false)
    })
})
