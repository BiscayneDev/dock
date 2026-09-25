import { describe, expect, it } from 'vitest'
import { balanceText, inviteLink, isInviteStatusCommand } from '@/lib/spectrum/user-invites'

describe('member invite commands', () => {
    it('recognizes balance commands', () => {
        expect(isInviteStatusCommand('invites')).toBe(true)
        expect(isInviteStatusCommand('my invites')).toBe(true)
        expect(isInviteStatusCommand('invite status')).toBe(true)
        expect(isInviteStatusCommand('invites left.')).toBe(true)
        expect(isInviteStatusCommand('Invite Status!')).toBe(true)
    })

    it('does not treat mint commands or chat as balance commands', () => {
        expect(isInviteStatusCommand('invite')).toBe(false)
        expect(isInviteStatusCommand('invite 3')).toBe(false)
        expect(isInviteStatusCommand('hey can you invite my friend')).toBe(false)
    })

    it('builds shareable links from the app URL', () => {
        const prev = process.env.NEXT_PUBLIC_APP_URL
        process.env.NEXT_PUBLIC_APP_URL = 'https://www.getdinghy.sh'
        expect(inviteLink('ABCD-2345')).toBe('https://www.getdinghy.sh/i/ABCD-2345')
        process.env.NEXT_PUBLIC_APP_URL = prev
    })

    it('describes balances', () => {
        expect(balanceText({ granted: 0, used: 0, remaining: 0 })).toContain("don't have any invites")
        expect(balanceText({ granted: 3, used: 3, remaining: 0 })).toContain('used all your invites')
        expect(balanceText({ granted: 3, used: 1, remaining: 2 })).toContain('2 invites left')
    })
})
