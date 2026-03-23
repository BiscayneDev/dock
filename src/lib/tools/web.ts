import { z } from 'zod'
import type { Tool, ToolResult } from '@/lib/llm/types'

// --- web_search ---

const SearchInput = z.object({
  query: z.string().describe('Search query'),
  maxResults: z.number().optional().default(5).describe('Max results (default 5)'),
})

// Direct Tavily API call — bypasses SDK to avoid header issues
async function tavilySearch(query: string, maxResults: number): Promise<{ answer: string | null; results: Array<{ title: string; url: string; content: string }> }> {
  const response = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: process.env.TAVILY_API_KEY,
      query,
      max_results: maxResults,
      search_depth: 'basic',
      include_answer: true,
    }),
  })

  if (!response.ok) {
    throw new Error(`Tavily API error: ${response.status} ${response.statusText}`)
  }

  const data = await response.json() as { answer?: string; results?: Array<{ title: string; url: string; content: string }> }
  return {
    answer: data.answer ?? null,
    results: (data.results ?? []).map((r) => ({
      title: r.title ?? '',
      url: r.url ?? '',
      content: (r.content ?? '').slice(0, 500),
    })),
  }
}

export const webSearch: Tool = {
  name: 'web_search',
  description: 'Search the web for real-time information — weather, news, sports scores, stock prices, facts, documentation, anything the user asks about.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'What to search for' },
      maxResults: { type: 'number', description: 'Max results (default 5)' },
    },
    required: ['query'],
  },
  async execute(input: unknown): Promise<ToolResult> {
    if (!process.env.TAVILY_API_KEY) {
      return { success: false, error: 'Web search is not configured' }
    }

    try {
      const parsed = SearchInput.parse(input)
      const { answer, results } = await tavilySearch(parsed.query, parsed.maxResults)

      return {
        success: true,
        data: { answer, results },
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { success: false, error: `Search failed: ${msg}` }
    }
  },
}

// --- web_fetch ---

const FetchInput = z.object({
  url: z.string().url().describe('URL to fetch'),
})

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

function extractTitle(html: string): string | null {
  const match = html.match(/<title[^>]*>([^<]+)<\/title>/i)
  return match ? match[1].trim() : null
}

const MAX_CONTENT_LENGTH = 8000

export const webFetch: Tool = {
  name: 'web_fetch',
  description: 'Fetch and read the content of a web page. ONLY use this when the user explicitly shares a URL they want you to read. Do NOT use this to browse news sites, articles, or gather information — use web_search instead. Many sites block automated fetching and return errors.',
  inputSchema: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'URL to fetch (must start with http:// or https://)' },
    },
    required: ['url'],
  },
  async execute(input: unknown): Promise<ToolResult> {
    try {
      const parsed = FetchInput.parse(input)

      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 10_000)

      try {
        const response = await fetch(parsed.url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; DockBot/1.0)',
            'Accept': 'text/html,application/xhtml+xml,text/plain',
          },
          signal: controller.signal,
          redirect: 'follow',
        })

        if (!response.ok) {
          return { success: false, error: `HTTP ${response.status}: ${response.statusText}` }
        }

        const html = await response.text()
        const title = extractTitle(html)
        const content = stripHtml(html).slice(0, MAX_CONTENT_LENGTH)

        return {
          success: true,
          data: {
            title,
            url: parsed.url,
            content,
            truncated: stripHtml(html).length > MAX_CONTENT_LENGTH,
          },
        }
      } finally {
        clearTimeout(timeoutId)
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        return { success: false, error: 'Request timed out (10s limit)' }
      }
      const msg = err instanceof Error ? err.message : String(err)
      return { success: false, error: `Fetch failed: ${msg}` }
    }
  },
}
