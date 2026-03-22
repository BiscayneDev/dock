import { z } from 'zod'
import type { Tool, ToolResult, UserContext } from '@/lib/llm/types'

const TWEET_FIELDS = 'text,author_id,created_at,public_metrics'
const USER_FIELDS = 'name,username'
const EXPANSIONS = 'author_id'

async function fetchTwitter(path: string, ctx: UserContext, params?: Record<string, string>): Promise<unknown> {
  if (!ctx.tokens.twitter) {
    throw new Error('Twitter not connected. Connect it in The Harbor.')
  }
  const { twitterFetch } = await import('@/lib/integrations/twitter')
  return twitterFetch(path, ctx.tokens.twitter, ctx.userId, params)
}

// Get the Twitter user ID from stored provider_account_id
async function getTwitterUserId(ctx: UserContext): Promise<string> {
  // Try fetching from /users/me
  const data = await fetchTwitter('/users/me', ctx) as { data: { id: string } }
  return data.data.id
}

function formatTweets(data: {
  data?: Array<{ text: string; author_id: string; created_at?: string; public_metrics?: Record<string, number> }>
  includes?: { users?: Array<{ id: string; name: string; username: string }> }
}): Array<Record<string, unknown>> {
  const users = new Map(
    (data.includes?.users ?? []).map((u) => [u.id, { name: u.name, username: u.username }])
  )

  return (data.data ?? []).map((tweet) => {
    const author = users.get(tweet.author_id)
    return {
      text: tweet.text,
      author: author ? `${author.name} (@${author.username})` : tweet.author_id,
      created_at: tweet.created_at,
      likes: tweet.public_metrics?.like_count,
      retweets: tweet.public_metrics?.retweet_count,
      replies: tweet.public_metrics?.reply_count,
    }
  })
}

// --- twitter_timeline ---

export const twitterTimeline: Tool = {
  name: 'twitter_timeline',
  description: "Get the user's home timeline — recent tweets from accounts they follow. Use this to understand what's happening in their Twitter world.",
  inputSchema: {
    type: 'object',
    properties: {
      maxResults: { type: 'number', description: 'Number of tweets to fetch (default 20, max 100)' },
    },
  },
  async execute(input: unknown, ctx: UserContext): Promise<ToolResult> {
    try {
      const parsed = z.object({
        maxResults: z.number().optional().default(20),
      }).parse(input)

      const userId = await getTwitterUserId(ctx)
      const maxResults = Math.min(parsed.maxResults, 100)

      const data = await fetchTwitter(`/users/${userId}/timelines/reverse_chronological`, ctx, {
        max_results: String(maxResults),
        'tweet.fields': TWEET_FIELDS,
        'user.fields': USER_FIELDS,
        expansions: EXPANSIONS,
      }) as { data?: unknown[]; includes?: unknown }

      const tweets = formatTweets(data as Parameters<typeof formatTweets>[0])

      return {
        success: true,
        data: {
          count: tweets.length,
          tweets,
        },
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { success: false, error: `Failed to fetch timeline: ${msg}` }
    }
  },
}

// --- twitter_search ---

export const twitterSearch: Tool = {
  name: 'twitter_search',
  description: 'Search recent tweets (last 7 days) by keyword, hashtag, or topic. Use this to find what people are saying about something.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query (supports Twitter search operators)' },
      maxResults: { type: 'number', description: 'Number of results (default 20, max 100)' },
    },
    required: ['query'],
  },
  async execute(input: unknown, ctx: UserContext): Promise<ToolResult> {
    try {
      const parsed = z.object({
        query: z.string().min(1),
        maxResults: z.number().optional().default(20),
      }).parse(input)

      const maxResults = Math.min(parsed.maxResults, 100)

      const data = await fetchTwitter('/tweets/search/recent', ctx, {
        query: parsed.query,
        max_results: String(maxResults),
        'tweet.fields': TWEET_FIELDS,
        'user.fields': USER_FIELDS,
        expansions: EXPANSIONS,
      }) as { data?: unknown[]; includes?: unknown }

      const tweets = formatTweets(data as Parameters<typeof formatTweets>[0])

      return {
        success: true,
        data: {
          query: parsed.query,
          count: tweets.length,
          tweets,
        },
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { success: false, error: `Twitter search failed: ${msg}` }
    }
  },
}

// --- twitter_user_tweets ---

export const twitterUserTweets: Tool = {
  name: 'twitter_user_tweets',
  description: "Get recent tweets from a specific Twitter user by their username (handle). Use this to check what someone specific has been posting.",
  inputSchema: {
    type: 'object',
    properties: {
      username: { type: 'string', description: 'Twitter username (without @)' },
      maxResults: { type: 'number', description: 'Number of tweets (default 10, max 100)' },
    },
    required: ['username'],
  },
  async execute(input: unknown, ctx: UserContext): Promise<ToolResult> {
    try {
      const parsed = z.object({
        username: z.string().min(1),
        maxResults: z.number().optional().default(10),
      }).parse(input)

      const maxResults = Math.min(parsed.maxResults, 100)

      // Look up user by username
      const userData = await fetchTwitter(`/users/by/username/${parsed.username}`, ctx, {
        'user.fields': 'name,username,public_metrics,description',
      }) as { data: { id: string; name: string; username: string; description?: string; public_metrics?: Record<string, number> } }

      if (!userData.data) {
        return { success: false, error: `User @${parsed.username} not found` }
      }

      // Fetch their tweets
      const tweetsData = await fetchTwitter(`/users/${userData.data.id}/tweets`, ctx, {
        max_results: String(maxResults),
        'tweet.fields': TWEET_FIELDS,
      }) as { data?: Array<{ text: string; created_at?: string; public_metrics?: Record<string, number> }> }

      const tweets = (tweetsData.data ?? []).map((t) => ({
        text: t.text,
        created_at: t.created_at,
        likes: t.public_metrics?.like_count,
        retweets: t.public_metrics?.retweet_count,
      }))

      return {
        success: true,
        data: {
          user: {
            name: userData.data.name,
            username: userData.data.username,
            bio: userData.data.description,
            followers: userData.data.public_metrics?.followers_count,
            following: userData.data.public_metrics?.following_count,
          },
          count: tweets.length,
          tweets,
        },
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { success: false, error: `Failed to fetch user tweets: ${msg}` }
    }
  },
}

// --- twitter_bookmarks ---

export const twitterBookmarks: Tool = {
  name: 'twitter_bookmarks',
  description: "Get the user's bookmarked tweets. Use this when the user asks about their saved tweets or bookmarks.",
  inputSchema: {
    type: 'object',
    properties: {
      maxResults: { type: 'number', description: 'Number of bookmarks (default 20, max 100)' },
    },
  },
  async execute(input: unknown, ctx: UserContext): Promise<ToolResult> {
    try {
      const parsed = z.object({
        maxResults: z.number().optional().default(20),
      }).parse(input)

      const userId = await getTwitterUserId(ctx)
      const maxResults = Math.min(parsed.maxResults, 100)

      const data = await fetchTwitter(`/users/${userId}/bookmarks`, ctx, {
        max_results: String(maxResults),
        'tweet.fields': TWEET_FIELDS,
        'user.fields': USER_FIELDS,
        expansions: EXPANSIONS,
      }) as { data?: unknown[]; includes?: unknown }

      const tweets = formatTweets(data as Parameters<typeof formatTweets>[0])

      return {
        success: true,
        data: {
          count: tweets.length,
          bookmarks: tweets,
        },
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { success: false, error: `Failed to fetch bookmarks: ${msg}` }
    }
  },
}
