import { describe, it, expect, vi, afterEach } from 'vitest'
import { parsePostId, cleanUsername, parseSyndicationTimeline, cookieStrings, xSearchEnabled, xFreeTools, xReadPost, xProfile, xRecentPosts, xSearch } from '@/lib/tools/x-free'
import { buildSystemPrompt } from '@/lib/spectrum/dinghy'

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } })
const ctx = { userId: '', telegramId: 0, telegramChatId: 0, name: '', timezone: 'America/New_York', tokens: {} }

describe('x-free parsing', () => {
  it('parses post links, ids and handles', () => {
    expect(parsePostId('https://x.com/jack/status/20')).toBe('20')
    expect(parsePostId('https://twitter.com/a_b/status/2102147636702634195?s=20')).toBe('2102147636702634195')
    expect(parsePostId('fxtwitter.com/x/status/12345')).toBe('12345')
    expect(parsePostId('2102147636702634195')).toBe('2102147636702634195')
    expect(parsePostId('hello')).toBeNull()
    expect(cleanUsername('@elonmusk')).toBe('elonmusk')
    expect(cleanUsername('https://x.com/BiscayneDev/status/1')).toBe('BiscayneDev')
    expect(cleanUsername('not a handle!')).toBeNull()
  })

  it('parses the embed timeline', () => {
    const data = { props: { pageProps: { timeline: { entries: [
      { type: 'tweet', content: { tweet: { full_text: 'hi', created_at: 'Mon Sep 21', permalink: '/X/status/9', favorite_count: 3, user: { screen_name: 'X' } } } },
      { type: 'other', content: {} },
    ] } } } }
    const html = `<html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(data)}</script></html>`
    expect(parseSyndicationTimeline(html, 5)).toEqual([{ author: '@X', text: 'hi', created_at: 'Mon Sep 21', url: 'https://x.com/X/status/9', likes: 3, reposts: undefined, replies: undefined }])
    expect(parseSyndicationTimeline('<html></html>', 5)).toEqual([])
  })

  it('builds x.com cookies', () => {
    expect(cookieStrings('auth_token=abc; ct0=def')).toEqual(['auth_token=abc; Domain=.x.com; Path=/; Secure', 'ct0=def; Domain=.x.com; Path=/; Secure'])
  })
})

describe('x-free tools', () => {
  it('reads a post via FxTwitter', async () => {
    const f = vi.fn(async () => json({ status: { url: 'https://x.com/jack/status/20', text: 'just setting up my twttr', author: { name: 'jack', screen_name: 'jack' }, likes: 1 } }))
    vi.stubGlobal('fetch', f)
    const r = await xReadPost.execute({ post: 'https://x.com/jack/status/20' }, ctx)
    expect(r.success).toBe(true)
    expect((r.data as { text: string }).text).toBe('just setting up my twttr')
    expect(String((f.mock.calls[0] as unknown[])[0])).toBe('https://api.fxtwitter.com/2/status/20')
  })

  it('reports missing posts and bad links', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ code: 404 }, 404)))
    expect((await xReadPost.execute({ post: 'https://x.com/a/status/1' }, ctx)).error).toMatch(/not found/)
    expect((await xReadPost.execute({ post: 'nope' }, ctx)).success).toBe(false)
  })

  it('looks up a profile', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ user: { name: 'X', screen_name: 'X', followers: 10 } })))
    const r = await xProfile.execute({ username: '@X' }, ctx)
    expect(r.data).toMatchObject({ name: 'X', username: 'X', followers: 10 })
  })

  it('reads recent posts from the embed timeline', async () => {
    const data = { props: { pageProps: { timeline: { entries: [{ type: 'tweet', content: { tweet: { full_text: 'gm', user: { screen_name: 'X' } } } }] } } } }
    vi.stubGlobal('fetch', vi.fn(async () => new Response(`<script id="__NEXT_DATA__" type="application/json">${JSON.stringify(data)}</script>`)))
    const r = await xRecentPosts.execute({ username: 'X' }, ctx)
    expect(r.success).toBe(true)
    expect((r.data as { count: number }).count).toBe(1)
  })

  it('search is off until burner cookies exist', async () => {
    vi.stubEnv('X_SEARCH_COOKIES', '')
    expect(xSearchEnabled()).toBe(false)
    expect(xFreeTools().map((t) => t.name)).toEqual(['x_read_post', 'x_profile', 'x_recent_posts'])
    expect(await xSearch.execute({ query: 'dinghy' }, ctx)).toEqual({ success: false, error: 'X search is not configured' })
    vi.stubEnv('X_SEARCH_COOKIES', 'auth_token=a; ct0=b')
    expect(xSearchEnabled()).toBe(true)
    expect(xFreeTools().map((t) => t.name)).toContain('x_search')
  })

  it('no tool can write to X', () => {
    vi.stubEnv('X_SEARCH_COOKIES', 'auth_token=a; ct0=b')
    for (const t of xFreeTools()) expect(t.name).toMatch(/^x_(read_post|profile|recent_posts|search)$/)
  })
})

describe('x-free prompt', () => {
  it('names free reads, and search only when configured', () => {
    const noSearch = buildSystemPrompt([], false, { google: false, wallet: false, xFree: true, xSearch: false })
    expect(noSearch).toContain('x_read_post')
    expect(noSearch).toContain("can't keyword-search X yet")
    expect(noSearch).not.toContain('call x_search')
    const withSearch = buildSystemPrompt([], false, { google: false, wallet: false, xFree: true, xSearch: true })
    expect(withSearch).toContain('call x_search')
  })
})
