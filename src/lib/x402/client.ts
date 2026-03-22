import { z } from 'zod'
import type { Tool, ToolResult, UserContext } from '@/lib/llm/types'
import { logger } from '@/lib/logger'

// x402 client tools — let Dock's agent consume external x402-gated APIs
// and discover services from the x402 Index.

const X402FetchInput = z.object({
  url: z.string().url().describe('URL of the x402-gated resource'),
  method: z.enum(['GET', 'POST', 'PUT', 'DELETE']).optional().default('GET'),
  body: z.string().optional().describe('Request body (for POST/PUT)'),
  maxPayment: z.number().optional().default(1).describe('Maximum USDC willing to pay (default $1)'),
})

const X402SearchInput = z.object({
  query: z.string().optional().describe('Search term to filter services'),
  category: z.string().optional().describe('Category filter'),
})

async function getPaymentFetch(ctx: UserContext): Promise<typeof fetch | null> {
  try {
    // Dynamic imports to avoid loading x402 when not needed
    const { wrapFetchWithPaymentFromConfig } = await import('@x402/fetch')
    const { ExactEvmScheme } = await import('@x402/evm')

    // Get user's wallet for payment signing
    const { getDecryptedOWSTokens, getOWSClient, extractWalletAddress } = await import('@/lib/integrations/openwallet')

    const tokens = await getDecryptedOWSTokens(ctx.userId)
    if (!tokens) return null

    const owsClient = getOWSClient(tokens)
    const walletInfo = await extractWalletAddress(owsClient)
    if (!walletInfo) return null

    // x402 uses viem accounts for signing — we need to create an OWS-backed signer
    // The ExactEvmScheme expects a viem Account, but we use OWS for signing.
    // We create a custom scheme that delegates to OWS.
    const owsSigner = createOWSSigner(owsClient, walletInfo.address)

    const paidFetch = wrapFetchWithPaymentFromConfig(fetch, {
      schemes: [
        {
          network: 'eip155:8453', // Base
          client: new ExactEvmScheme(owsSigner),
        },
      ],
    })

    return paidFetch
  } catch (err) {
    logger.error('Failed to create x402 payment fetch', {
      error: err instanceof Error ? err.message : String(err),
    })
    return null
  }
}

// Create a viem-compatible account that delegates signing to OWS
function createOWSSigner(
  owsClient: { listWallets: () => Promise<{ ok: boolean; data?: unknown }>; signMessage: (walletId: string, chainId: string, message: string) => Promise<{ ok: boolean; data?: unknown }> },
  address: string
) {
  return {
    address: address as `0x${string}`,
    type: 'custom' as const,
    async signMessage({ message }: { message: string | Uint8Array }) {
      const messageStr = typeof message === 'string' ? message : Buffer.from(message).toString('utf-8')
      const walletsRes = await owsClient.listWallets()
      const wallets = (walletsRes.data ?? []) as Array<{ id: string }>
      if (wallets.length === 0) throw new Error('No wallet available for x402 signing')

      const result = await owsClient.signMessage(wallets[0].id, 'eip155:8453', messageStr)
      if (!result.ok) throw new Error('OWS signing failed')

      const sig = result.data as { signature?: string }
      return (sig.signature ?? '') as `0x${string}`
    },
    async signTypedData(typedData: unknown) {
      // x402 EVM scheme uses EIP-3009 transferWithAuthorization which requires signTypedData
      const walletsRes = await owsClient.listWallets()
      const wallets = (walletsRes.data ?? []) as Array<{ id: string }>
      if (wallets.length === 0) throw new Error('No wallet available for x402 signing')

      // Serialize typed data for OWS signing
      const message = JSON.stringify(typedData)
      const result = await owsClient.signMessage(wallets[0].id, 'eip155:8453', message)
      if (!result.ok) throw new Error('OWS typed data signing failed')

      const sig = result.data as { signature?: string }
      return (sig.signature ?? '') as `0x${string}`
    },
    async signTransaction() {
      throw new Error('x402 does not require transaction signing')
    },
  }
}

export const x402Fetch: Tool = {
  name: 'x402_fetch',
  description: 'Call a paid API using the x402 protocol. Automatically pays with the user\'s wallet. Use after finding a service with x402_search, or when you have a URL to an x402-gated endpoint. Handles payment negotiation, signing, and verification automatically.',
  inputSchema: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'URL of the x402-gated resource' },
      method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'DELETE'], description: 'HTTP method (default GET)' },
      body: { type: 'string', description: 'Request body for POST/PUT' },
      maxPayment: { type: 'number', description: 'Maximum USDC willing to pay (default $1)' },
    },
    required: ['url'],
  },
  async execute(input: unknown, ctx: UserContext): Promise<ToolResult> {
    try {
      const parsed = X402FetchInput.parse(input)

      const paidFetch = await getPaymentFetch(ctx)
      if (!paidFetch) {
        return {
          success: false,
          error: 'No wallet connected. Connect a MoonPay wallet to use x402 paid APIs.',
        }
      }

      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 30_000)

      try {
        const options: RequestInit = {
          method: parsed.method,
          signal: controller.signal,
          headers: {
            'Accept': 'application/json, text/plain, */*',
            'User-Agent': 'Dock/1.0 (x402-client)',
          },
        }

        if (parsed.body && (parsed.method === 'POST' || parsed.method === 'PUT')) {
          options.headers = { ...options.headers as Record<string, string>, 'Content-Type': 'application/json' }
          options.body = parsed.body
        }

        const response = await paidFetch(parsed.url, options)

        if (!response.ok) {
          return {
            success: false,
            error: `Request failed: HTTP ${response.status} ${response.statusText}`,
          }
        }

        const contentType = response.headers.get('content-type') ?? ''
        const isJson = contentType.includes('application/json')
        const data = isJson ? await response.json() : await response.text()

        // Check for payment receipt in response headers
        const paymentResponse = response.headers.get('payment-response')

        return {
          success: true,
          data: {
            status: response.status,
            body: typeof data === 'string' ? data.slice(0, 8000) : data,
            paid: !!paymentResponse,
            paymentReceipt: paymentResponse ?? null,
          },
        }
      } finally {
        clearTimeout(timeoutId)
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        return { success: false, error: 'Request timed out (30s limit)' }
      }
      const msg = err instanceof Error ? err.message : String(err)
      logger.error('x402 fetch failed', { error: msg })
      return { success: false, error: `x402 request failed: ${msg}` }
    }
  },
}

export const x402Search: Tool = {
  name: 'x402_search',
  description: 'Search the x402 marketplace for paid API services. Use when the user asks for capabilities beyond built-in tools — like market data, premium content, specialized AI models, image generation, or any third-party service. Returns services you can call with x402_fetch.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search term to filter services' },
      category: { type: 'string', description: 'Category filter' },
    },
  },
  async execute(input: unknown): Promise<ToolResult> {
    try {
      const parsed = X402SearchInput.parse(input)

      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 10_000)

      try {
        const url = new URL('https://www.x402index.com/api/all')
        if (parsed.query) url.searchParams.set('search', parsed.query)
        if (parsed.category) url.searchParams.set('category', parsed.category)

        const response = await fetch(url.toString(), {
          headers: {
            'Accept': 'application/json',
            'User-Agent': 'Dock/1.0 (x402-client)',
          },
          signal: controller.signal,
        })

        if (!response.ok) {
          // If 402, the index itself requires payment — fall back to basic info
          if (response.status === 402) {
            return {
              success: true,
              data: {
                note: 'The x402 Index requires payment for full results. Use x402_fetch to access it with your wallet.',
                indexUrl: 'https://www.x402index.com/api/all',
              },
            }
          }
          return { success: false, error: `Index request failed: HTTP ${response.status}` }
        }

        const data = await response.json()

        // Extract and format services list
        const services = Array.isArray(data) ? data : (data as Record<string, unknown>).services ?? data
        const formatted = (Array.isArray(services) ? services : []).slice(0, 20).map((s: Record<string, unknown>) => ({
          name: s.name ?? s.title ?? 'Unknown',
          description: s.description ?? '',
          url: s.url ?? s.endpoint ?? '',
          price: s.price ?? s.cost ?? null,
          category: s.category ?? null,
        }))

        return {
          success: true,
          data: {
            count: formatted.length,
            services: formatted,
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
      return { success: false, error: `x402 index search failed: ${msg}` }
    }
  },
}
