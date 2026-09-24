import { describe, it, expect, vi } from 'vitest'
import { buildSystemPrompt } from '@/lib/spectrum/dinghy'

vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => ({}) }))
vi.mock('@/lib/crypto', () => ({ decryptTokenFromDb: (v: string) => v }))

const base = { userId: 'u1', telegramId: 0, telegramChatId: 0, name: '', timezone: 'America/New_York' }
const tok = { accessToken: 'a', refreshToken: null, expiresAt: null }

describe('GitHub on iMessage', () => {
  it('offers GitHub read tools only when GitHub is connected, never create_issue', async () => {
    const { toolsFor, capabilitiesFor } = await import('@/lib/spectrum/imessage-tools')
    const none = { ...base, tokens: {} }
    expect(toolsFor(none).some((t) => t.name.startsWith('github_'))).toBe(false)
    expect(capabilitiesFor(none).github).toBe(false)
    const gh = { ...base, tokens: { github: tok } }
    const names = toolsFor(gh).map((t) => t.name)
    expect(names).toEqual(expect.arrayContaining(['github_list_repos', 'github_get_repo', 'github_list_issues', 'github_get_issue', 'github_list_prs', 'github_get_pr', 'github_list_notifications']))
    expect(names).not.toContain('github_create_issue')
    expect(capabilitiesFor(gh).github).toBe(true)
  })

  it('prompt mentions GitHub only when offered, read-only', () => {
    const on = buildSystemPrompt([], false, { google: false, wallet: false, github: true })
    expect(on).toContain('github_ tools')
    expect(on).toContain('only read GitHub')
    expect(buildSystemPrompt([], false, { google: false, wallet: false })).not.toContain('github_ tools')
  })
})

describe('GitHub connect from iMessage', () => {
  it('detects GitHub asks', async () => {
    const { wantsGithub } = await import('@/lib/spectrum/dinghy')
    expect(wantsGithub('any new PRs on github?')).toBe(true)
    expect(wantsGithub('what issues are open in my repos')).toBe(true)
    expect(wantsGithub('check my pull requests')).toBe(true)
    expect(wantsGithub("what's the weather")).toBe(false)
    expect(wantsGithub('we have issues with dinner')).toBe(false)
  })

  it('auth url carries the connect state only when given', async () => {
    vi.stubEnv('GITHUB_CLIENT_ID', 'cid')
    vi.stubEnv('GITHUB_REDIRECT_URI', 'https://example.test/auth/callback/github')
    const { getAuthUrl } = await import('@/lib/integrations/github')
    expect(new URL(getAuthUrl()).searchParams.get('state')).toBeNull()
    const u = new URL(getAuthUrl(['repo', 'notifications'], 'st8'))
    expect(u.searchParams.get('state')).toBe('st8')
    expect(u.searchParams.get('scope')).toBe('repo notifications')
    vi.unstubAllEnvs()
  })
})
