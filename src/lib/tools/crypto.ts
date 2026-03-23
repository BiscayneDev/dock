import { z } from 'zod'
import type { Tool, ToolResult } from '@/lib/llm/types'

// --- token_price ---

const PriceInput = z.object({
  token: z.string().describe('Token symbol or CoinGecko ID (e.g. "bitcoin", "solana", "ethereum", "SOL", "ETH")'),
})

const SYMBOL_MAP: Record<string, string> = {
  btc: 'bitcoin', bitcoin: 'bitcoin',
  eth: 'ethereum', ethereum: 'ethereum',
  sol: 'solana', solana: 'solana',
  usdc: 'usd-coin', usdt: 'tether',
  matic: 'matic-network', polygon: 'matic-network',
  avax: 'avalanche-2', avalanche: 'avalanche-2',
  bnb: 'binancecoin', dot: 'polkadot',
  ada: 'cardano', xrp: 'ripple',
  doge: 'dogecoin', shib: 'shiba-inu',
  link: 'chainlink', uni: 'uniswap',
  arb: 'arbitrum', op: 'optimism',
  base: 'base-protocol',
}

function resolveTokenId(input: string): string {
  const lower = input.toLowerCase().trim()
  return SYMBOL_MAP[lower] ?? lower
}

export const tokenPrice: Tool = {
  name: 'token_price',
  description: 'Get the current price, 24h change, and market cap for a cryptocurrency. Works for any token — BTC, ETH, SOL, etc.',
  inputSchema: {
    type: 'object',
    properties: {
      token: { type: 'string', description: 'Token symbol or name (e.g. "SOL", "bitcoin", "ETH")' },
    },
    required: ['token'],
  },
  async execute(input: unknown): Promise<ToolResult> {
    try {
      const parsed = PriceInput.parse(input)
      const id = resolveTokenId(parsed.token)

      const res = await fetch(`https://api.coingecko.com/api/v3/coins/${id}?localization=false&tickers=false&community_data=false&developer_data=false`, {
        headers: { 'Accept': 'application/json' },
      })

      if (!res.ok) {
        if (res.status === 404) return { success: false, error: `Token "${parsed.token}" not found. Try the full name (e.g. "bitcoin" not "BTC").` }
        return { success: false, error: `CoinGecko API error: ${res.status}` }
      }

      const data = await res.json() as {
        name: string; symbol: string
        market_data: {
          current_price: { usd: number }
          price_change_percentage_24h: number
          market_cap: { usd: number }
          total_volume: { usd: number }
          high_24h: { usd: number }
          low_24h: { usd: number }
        }
      }

      return {
        success: true,
        data: {
          name: data.name,
          symbol: data.symbol.toUpperCase(),
          price: data.market_data.current_price.usd,
          change_24h: data.market_data.price_change_percentage_24h?.toFixed(2) + '%',
          market_cap: data.market_data.market_cap.usd,
          volume_24h: data.market_data.total_volume.usd,
          high_24h: data.market_data.high_24h.usd,
          low_24h: data.market_data.low_24h.usd,
        },
      }
    } catch (err) {
      return { success: false, error: `Price lookup failed: ${err instanceof Error ? err.message : String(err)}` }
    }
  },
}

// --- trending_tokens ---

export const trendingTokens: Tool = {
  name: 'trending_tokens',
  description: 'Get the top trending cryptocurrencies right now. Shows what tokens people are searching for.',
  inputSchema: { type: 'object', properties: {} },
  async execute(): Promise<ToolResult> {
    try {
      const res = await fetch('https://api.coingecko.com/api/v3/search/trending', {
        headers: { 'Accept': 'application/json' },
      })

      if (!res.ok) return { success: false, error: `CoinGecko API error: ${res.status}` }

      const data = await res.json() as { coins: Array<{ item: { name: string; symbol: string; market_cap_rank: number; data: { price: string; price_change_percentage_24h: { usd: number } } } }> }

      const trending = data.coins.slice(0, 10).map((c) => ({
        name: c.item.name,
        symbol: c.item.symbol,
        rank: c.item.market_cap_rank,
        price: c.item.data?.price ?? 'N/A',
        change_24h: c.item.data?.price_change_percentage_24h?.usd != null ? c.item.data.price_change_percentage_24h.usd.toFixed(2) + '%' : 'N/A',
      }))

      return { success: true, data: { trending } }
    } catch (err) {
      return { success: false, error: `Trending lookup failed: ${err instanceof Error ? err.message : String(err)}` }
    }
  },
}

// --- prediction_markets ---

const PredictionInput = z.object({
  query: z.string().optional().describe('Search query to filter markets'),
  tag: z.string().optional().describe('Category: Politics, Crypto, Sports, Pop Culture, Business, Science'),
})

export const predictionMarkets: Tool = {
  name: 'prediction_markets',
  description: 'Search Polymarket prediction markets. Find what people are betting on — politics, crypto, world events, sports. Returns current odds and volume. Always provide a search query for best results.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search term (e.g. "iran", "trump", "bitcoin", "oil"). Be specific.' },
      tag: { type: 'string', description: 'Category filter: Politics, Crypto, Sports, Pop Culture, Business, Science' },
    },
  },
  async execute(input: unknown): Promise<ToolResult> {
    try {
      const parsed = PredictionInput.parse(input)

      type MarketItem = {
        question: string
        description: string
        outcomes: string
        outcomePrices: string
        volume: string
        volume24hr?: string
        liquidity: string
        endDate: string
        slug: string
      }

      // Strategy: query both events and markets endpoints for better coverage
      const results: Array<{ question: string; outcomes: Array<{ outcome: string; probability: string }>; volume: string; volume24h: string; ends: string; url?: string }> = []

      // 1. Search events (topic-level groupings, better for broad topics)
      const eventsUrl = new URL('https://gamma-api.polymarket.com/events')
      eventsUrl.searchParams.set('closed', 'false')
      eventsUrl.searchParams.set('limit', '20')
      eventsUrl.searchParams.set('order', 'volume')
      eventsUrl.searchParams.set('ascending', 'false')
      if (parsed.tag) eventsUrl.searchParams.set('tag', parsed.tag)

      // 2. Search markets (individual questions, more granular)
      const marketsUrl = new URL('https://gamma-api.polymarket.com/markets')
      marketsUrl.searchParams.set('closed', 'false')
      marketsUrl.searchParams.set('limit', '50')
      marketsUrl.searchParams.set('order', 'volume24hr')
      marketsUrl.searchParams.set('ascending', 'false')
      marketsUrl.searchParams.set('active', 'true')

      const [eventsRes, marketsRes] = await Promise.allSettled([
        fetch(eventsUrl.toString(), { headers: { 'Accept': 'application/json' } }),
        fetch(marketsUrl.toString(), { headers: { 'Accept': 'application/json' } }),
      ])

      // Process events
      if (eventsRes.status === 'fulfilled' && eventsRes.value.ok) {
        const events = await eventsRes.value.json() as Array<{
          title: string
          slug: string
          volume: string
          markets?: MarketItem[]
        }>

        for (const event of events) {
          // Get the top market from each event
          const topMarket = (event.markets ?? [])
            .filter((m) => m.outcomePrices)
            .sort((a, b) => parseFloat(b.volume ?? '0') - parseFloat(a.volume ?? '0'))[0]

          if (topMarket) {
            const formatted = formatMarket(topMarket, event.slug)
            if (formatted) results.push(formatted)
          }
        }
      }

      // Process individual markets
      if (marketsRes.status === 'fulfilled' && marketsRes.value.ok) {
        const markets = await marketsRes.value.json() as MarketItem[]
        for (const m of (Array.isArray(markets) ? markets : [])) {
          const formatted = formatMarket(m)
          if (formatted) results.push(formatted)
        }
      }

      // Dedupe by question
      const seen = new Set<string>()
      const deduped = results.filter((r) => {
        const key = r.question.toLowerCase()
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })

      // Filter by query — use multiple keyword matching for better recall
      let filtered = deduped
      if (parsed.query) {
        const keywords = parsed.query.toLowerCase().split(/\s+/).filter((w) => w.length > 2)
        filtered = deduped.filter((m) => {
          const text = m.question.toLowerCase()
          // Match if ANY keyword appears in the question
          return keywords.some((kw) => text.includes(kw))
        })

        // If no matches, try broader matching against all results
        if (filtered.length === 0) {
          filtered = deduped.filter((m) => {
            const text = m.question.toLowerCase()
            return keywords.some((kw) => text.split(/\s+/).some((word) => word.startsWith(kw) || kw.startsWith(word)))
          })
        }
      }

      // Sort by 24h volume
      filtered.sort((a, b) => {
        const volA = parseFloat(a.volume24h.replace(/[$,]/g, '') || '0')
        const volB = parseFloat(b.volume24h.replace(/[$,]/g, '') || '0')
        return volB - volA
      })

      return {
        success: true,
        data: {
          query: parsed.query ?? 'trending',
          count: Math.min(filtered.length, 10),
          markets: filtered.slice(0, 10),
          note: filtered.length === 0 && parsed.query
            ? `No markets found for "${parsed.query}". Try broader terms or check trending markets without a query.`
            : undefined,
        },
      }
    } catch (err) {
      return { success: false, error: `Prediction markets failed: ${err instanceof Error ? err.message : String(err)}` }
    }
  },
}

function formatMarket(m: { question: string; outcomes: string; outcomePrices: string; volume: string; volume24hr?: string; endDate: string; slug: string }, eventSlug?: string) {
  let outcomes: Array<{ outcome: string; probability: string }> = []
  try {
    const names = JSON.parse(m.outcomes ?? '[]') as string[]
    const prices = JSON.parse(m.outcomePrices ?? '[]') as string[]
    outcomes = names.map((o, i) => ({
      outcome: o,
      probability: prices[i] ? (parseFloat(prices[i]) * 100).toFixed(1) + '%' : 'N/A',
    }))
  } catch { return null }

  if (outcomes.length === 0) return null

  return {
    question: m.question,
    outcomes,
    volume: m.volume ? `$${parseFloat(m.volume).toLocaleString()}` : 'N/A',
    volume24h: m.volume24hr ? `$${parseFloat(m.volume24hr).toLocaleString()}` : 'N/A',
    ends: m.endDate ?? 'N/A',
    url: `https://polymarket.com/event/${eventSlug ?? m.slug}`,
  }
}
