import { describe, it, expect, vi } from 'vitest'
import { buildSystemPrompt } from '@/lib/spectrum/dinghy'

vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => ({}) }))
vi.mock('@/lib/crypto', () => ({ decryptTokenFromDb: (v: string) => v }))

const base = { userId: 'u1', telegramId: 0, telegramChatId: 0, name: '', timezone: 'America/New_York' }
const tok = { accessToken: 'a', refreshToken: null, expiresAt: null }

describe('X on iMessage', () => {
  it('offers X read tools only when X is connected', async () => {
    vi.stubEnv('TAVILY_API_KEY', '')
    const { toolsFor, capabilitiesFor, guestCapabilities } = await import('@/lib/spectrum/imessage-tools')
    const none = { ...base, tokens: {} }
    expect(toolsFor(none).map((t) => t.name)).not.toContain('twitter_search')
    expect(capabilitiesFor(none).x).toBe(false)
    expect(guestCapabilities().x).toBe(false)
    const withX = { ...base, tokens: { twitter: tok } }
    const names = toolsFor(withX).map((t) => t.name)
    expect(names).toEqual(expect.arrayContaining(['twitter_search', 'twitter_timeline', 'twitter_user_tweets']))
    expect(names).not.toContain('twitter_bookmarks')
    expect(capabilitiesFor(withX).x).toBe(true)
    vi.unstubAllEnvs()
  })

  it('prompt mentions X only when offered, and read-only', () => {
    const on = buildSystemPrompt([], false, { google: false, wallet: false, x: true })
    expect(on).toContain('twitter_search')
    expect(on).toContain('only read X')
    const off = buildSystemPrompt([], false, { google: false, wallet: false })
    expect(off).not.toContain('twitter_search')
  })
})
