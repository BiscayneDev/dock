import { z } from 'zod'
import type { Tool, ToolResult } from '@/lib/llm/types'

/**
 * Free, read-only X (Twitter) tools. No X API, no per-read cost.
 *
 * - x_read_post / x_profile: FxTwitter API (api.fxtwitter.com), no key.
 * - x_recent_posts: X's own embed timeline (syndication.twitter.com), no key.
 * - x_search: logged-in search via @the-convocation/twitter-scraper, using a
 *   dedicated burner account's cookies from X_SEARCH_COOKIES. Offered only when
 *   that env var is set. Never Halsey's main account.
 *
 * Reads only (Halsey, 2026-09-23): nothing here can post, like, follow or DM.
 */

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36'
const TIMEOUT_MS = 10_000

async function getJson(url: string): Promise<{ status: number; body: unknown }> {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) })
    let body: unknown = null
    try { body = await res.json() } catch { body = null }
    return { status: res.status, body }
}

/** Pull a numeric post id out of an x.com / twitter.com / fx link, or a bare id. */
export function parsePostId(input: string): string | null {
    const s = input.trim()
    if (/^\d{5,25}$/.test(s)) return s
    const m = s.match(/(?:x|twitter|fxtwitter|fixupx|vxtwitter|nitter)[^/]*\/[^/]+\/status(?:es)?\/(\d{1,25})/i)
    return m ? m[1] : null
}

export function cleanUsername(input: string): string | null {
    const s = input.trim().replace(/^@/, '').replace(/^https?:\/\/(www\.)?(x|twitter)\.com\//i, '').split(/[/?#]/)[0]
    return /^[A-Za-z0-9_]{1,15}$/.test(s) ? s : null
}

interface FxStatus {
    url?: string; text?: string; created_at?: string
    author?: { name?: string; screen_name?: string }
    likes?: number; reposts?: number; replies?: number; views?: number
    quote?: FxStatus
    media?: { all?: Array<{ type?: string; url?: string }> }
}

function shapeFx(s: FxStatus): Record<string, unknown> {
    return {
        author: s.author ? `${s.author.name ?? ''} (@${s.author.screen_name ?? ''})` : undefined,
        text: s.text,
        created_at: s.created_at,
        url: s.url,
        likes: s.likes, reposts: s.reposts, replies: s.replies, views: s.views,
        media: s.media?.all?.map((m) => m.type).filter(Boolean),
        quoted: s.quote ? { author: s.quote.author?.screen_name, text: s.quote.text } : undefined,
    }
}

export const xReadPost: Tool = {
    name: 'x_read_post',
    description: 'Read one X (Twitter) post from its link or id: text, author, time, likes/reposts, quoted post. Read-only.',
    inputSchema: {
        type: 'object',
        properties: { post: { type: 'string', description: 'x.com/twitter.com status link, or the numeric post id' } },
        required: ['post'],
    },
    async execute(input: unknown): Promise<ToolResult> {
        try {
            const { post } = z.object({ post: z.string().min(1) }).parse(input)
            const id = parsePostId(post)
            if (!id) return { success: false, error: 'That does not look like an X post link' }
            const { status, body } = await getJson(`https://api.fxtwitter.com/2/status/${id}`)
            const s = (body as { status?: FxStatus } | null)?.status
            if (status !== 200 || !s) return { success: false, error: status === 404 ? 'Post not found (deleted or private)' : `X read failed (${status})` }
            return { success: true, data: shapeFx(s) }
        } catch (err) {
            return { success: false, error: `X read failed: ${err instanceof Error ? err.message : String(err)}` }
        }
    },
}

export const xProfile: Tool = {
    name: 'x_profile',
    description: 'Look up an X (Twitter) account: name, bio, followers, post count. Read-only.',
    inputSchema: {
        type: 'object',
        properties: { username: { type: 'string', description: 'X handle, with or without @' } },
        required: ['username'],
    },
    async execute(input: unknown): Promise<ToolResult> {
        try {
            const { username } = z.object({ username: z.string().min(1) }).parse(input)
            const u = cleanUsername(username)
            if (!u) return { success: false, error: 'Not a valid X handle' }
            const { status, body } = await getJson(`https://api.fxtwitter.com/2/profile/${u}`)
            const p = (body as { user?: Record<string, unknown> } | null)?.user
            if (status !== 200 || !p) return { success: false, error: status === 404 ? `@${u} not found` : `X lookup failed (${status})` }
            return {
                success: true,
                data: {
                    name: p.name, username: p.screen_name, bio: p.description, url: p.url,
                    followers: p.followers, following: p.following, posts: p.statuses,
                    joined: p.joined, location: p.location, verified: (p.verification as { verified?: boolean } | undefined)?.verified,
                },
            }
        } catch (err) {
            return { success: false, error: `X lookup failed: ${err instanceof Error ? err.message : String(err)}` }
        }
    },
}

interface SynTweet {
    full_text?: string; created_at?: string; permalink?: string
    favorite_count?: number; retweet_count?: number; reply_count?: number
    user?: { screen_name?: string; name?: string }
}

/** Parse the embed timeline page's __NEXT_DATA__ into posts. Exported for tests. */
export function parseSyndicationTimeline(html: string, limit: number): Array<Record<string, unknown>> {
    const m = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/)
    if (!m) return []
    const data = JSON.parse(m[1]) as { props?: { pageProps?: { timeline?: { entries?: Array<{ type?: string; content?: { tweet?: SynTweet } }> } } } }
    const entries = data.props?.pageProps?.timeline?.entries ?? []
    return entries
        .filter((e) => e.type === 'tweet' && e.content?.tweet)
        .slice(0, limit)
        .map((e) => {
            const t = e.content!.tweet!
            return {
                author: t.user?.screen_name ? `@${t.user.screen_name}` : undefined,
                text: t.full_text,
                created_at: t.created_at,
                url: t.permalink ? `https://x.com${t.permalink}` : undefined,
                likes: t.favorite_count, reposts: t.retweet_count, replies: t.reply_count,
            }
        })
}

export const xRecentPosts: Tool = {
    name: 'x_recent_posts',
    description: "What an X (Twitter) account has posted lately (recent posts, newest first; may include pinned). Read-only.",
    inputSchema: {
        type: 'object',
        properties: {
            username: { type: 'string', description: 'X handle, with or without @' },
            limit: { type: 'number', description: 'How many posts (default 8, max 20)' },
        },
        required: ['username'],
    },
    async execute(input: unknown): Promise<ToolResult> {
        try {
            const p = z.object({ username: z.string().min(1), limit: z.number().optional().default(8) }).parse(input)
            const u = cleanUsername(p.username)
            if (!u) return { success: false, error: 'Not a valid X handle' }
            const res = await fetch(`https://syndication.twitter.com/srv/timeline-profile/screen-name/${u}`, {
                headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(TIMEOUT_MS),
            })
            if (!res.ok) return { success: false, error: `X timeline failed (${res.status})` }
            const posts = parseSyndicationTimeline(await res.text(), Math.min(Math.max(1, p.limit), 20))
            if (!posts.length) return { success: false, error: `No recent posts visible for @${u}` }
            return { success: true, data: { username: u, count: posts.length, posts } }
        } catch (err) {
            return { success: false, error: `X timeline failed: ${err instanceof Error ? err.message : String(err)}` }
        }
    },
}

/** Search needs a burner account's cookies (auth_token + ct0). */
export function xSearchEnabled(): boolean {
    const c = process.env.X_SEARCH_COOKIES ?? ''
    return /auth_token=/.test(c) && /ct0=/.test(c)
}

/** "auth_token=...; ct0=..." -> cookie strings scoped to x.com. Exported for tests. */
export function cookieStrings(raw: string): string[] {
    return raw.split(';').map((p) => p.trim()).filter((p) => /^[A-Za-z0-9_]+=.+/.test(p))
        .map((p) => `${p}; Domain=.x.com; Path=/; Secure`)
}

export const xSearch: Tool = {
    name: 'x_search',
    description: 'Search recent X (Twitter) posts by keyword, hashtag or phrase (supports from:, since:, etc.). Read-only.',
    inputSchema: {
        type: 'object',
        properties: {
            query: { type: 'string', description: 'Search query' },
            latest: { type: 'boolean', description: 'Newest first instead of top posts (default false)' },
            limit: { type: 'number', description: 'How many posts (default 10, max 20)' },
        },
        required: ['query'],
    },
    async execute(input: unknown): Promise<ToolResult> {
        try {
            if (!xSearchEnabled()) return { success: false, error: 'X search is not configured' }
            const p = z.object({ query: z.string().min(1), latest: z.boolean().optional().default(false), limit: z.number().optional().default(10) }).parse(input)
            const { Scraper, SearchMode } = await import('@the-convocation/twitter-scraper')
            const scraper = new Scraper()
            await scraper.setCookies(cookieStrings(process.env.X_SEARCH_COOKIES ?? ''))
            const max = Math.min(Math.max(1, p.limit), 20)
            const posts: Array<Record<string, unknown>> = []
            for await (const t of scraper.searchTweets(p.query, max, p.latest ? SearchMode.Latest : SearchMode.Top)) {
                posts.push({
                    author: t.username ? `${t.name ?? ''} (@${t.username})` : undefined,
                    text: t.text, created_at: t.timeParsed?.toISOString(), url: t.permanentUrl,
                    likes: t.likes, reposts: t.retweets, replies: t.replies,
                })
                if (posts.length >= max) break
            }
            return { success: true, data: { query: p.query, count: posts.length, posts } }
        } catch (err) {
            return { success: false, error: `X search failed: ${err instanceof Error ? err.message : String(err)}` }
        }
    },
}

/** Free X read tools for every chat, plus search when burner cookies exist. */
export function xFreeTools(): Tool[] {
    return [xReadPost, xProfile, xRecentPosts, ...(xSearchEnabled() ? [xSearch] : [])]
}
