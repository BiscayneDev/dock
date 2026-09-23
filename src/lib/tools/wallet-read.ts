import { getPayboxSdk, isPayboxConnected, payboxRequired } from '@/lib/integrations/paybox'
import type { Tool, ToolResult, UserContext } from '@/lib/llm/types'

// Read-only PayBox wallet tools for the iMessage path (Phase A). No tool here
// signs, sends, swaps, or reveals anything: balances are public on-chain data
// read through PayBox, scoped to the wallets the user granted Dinghy.

interface Holding {
  symbol: string
  name?: string
  network?: string | number
  amount?: string | number
  usd?: number | null
}

function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v)
  return null
}

/** Find the holdings array in a portfolio payload without trusting one exact shape. */
function findHoldings(obj: unknown, depth = 0): Record<string, unknown>[] {
  if (!obj || typeof obj !== 'object' || depth > 3) return []
  if (Array.isArray(obj)) {
    if (obj.some((x) => x && typeof x === 'object' && 'symbol' in (x as object))) {
      return obj as Record<string, unknown>[]
    }
    return []
  }
  for (const v of Object.values(obj as Record<string, unknown>)) {
    const found = findHoldings(v, depth + 1)
    if (found.length) return found
  }
  return []
}

/** Compact a portfolio so it fits the model's tool-result budget. */
export function compactPortfolio(raw: unknown): { total_usd: number | null; holdings: Holding[]; more: number } {
  const r = (raw ?? {}) as Record<string, unknown>
  const rows = findHoldings(raw).map((h): Holding => {
    const usd =
      num(h.balanceUsd) ?? num(h.balance_usd) ?? num(h.usd) ?? num(h.valueUsd) ?? num(h.value_usd) ?? null
    return {
      symbol: String(h.symbol ?? '?'),
      name: typeof h.name === 'string' ? h.name : undefined,
      network: (h.networkId ?? h.network_id ?? h.network ?? h.chain) as string | number | undefined,
      amount: (h.balance ?? h.displayBalance ?? h.display_balance ?? h.amount ?? h.uiAmount) as
        | string
        | number
        | undefined,
      usd,
    }
  })
  rows.sort((a, b) => (b.usd ?? 0) - (a.usd ?? 0))
  const nonzero = rows.filter((h) => (h.usd ?? 0) > 0.01 || num(h.amount) !== 0)
  const top = nonzero.slice(0, 12)
  return {
    total_usd: num(r.total_usd) ?? num(r.totalUsd),
    holdings: top,
    more: Math.max(0, nonzero.length - top.length),
  }
}

export const walletBalances: Tool = {
  name: 'wallet_balances',
  description:
    "Read the user's crypto wallet balances through PayBox: every wallet they granted Dinghy " +
    '(EVM and Solana), with token holdings and USD value. Read-only — nothing moves. ' +
    'Use for "what\'s my balance", "how much USDC do I have", "what\'s in my wallet".',
  inputSchema: { type: 'object', properties: {} },
  async execute(_input: unknown, ctx: UserContext): Promise<ToolResult> {
    if (!isPayboxConnected(ctx)) return payboxRequired('reading wallet balances')
    try {
      const sdk = await getPayboxSdk(ctx.tokens.paybox, ctx.userId)
      const list = await sdk.listCredentials()
      const wallets = list.credentials.filter((c) => c.credential.credential_type === 'wallet')
      if (wallets.length === 0) {
        return {
          success: true,
          data: {
            wallets: [],
            note:
              'No wallet is granted to Dinghy in PayBox yet. The user can grant one in the PayBox app ' +
              '(app.paybox.sh → Clients → Dinghy).',
          },
        }
      }
      const out = await Promise.all(
        wallets.map(async (w) => {
          const meta = (w.credential.metadata ?? {}) as Record<string, unknown>
          const address = typeof meta.address === 'string' ? meta.address : null
          const base = {
            name: w.credential.name,
            chains: meta.chains ?? null,
            address,
            approval_mode: w.grant.approval_mode,
          }
          if (!address) return { ...base, error: 'wallet address not captured yet in PayBox' }
          try {
            return { ...base, ...compactPortfolio(await sdk.getPortfolio({ address })) }
          } catch (err) {
            return { ...base, error: err instanceof Error ? err.message : String(err) }
          }
        })
      )
      return { success: true, data: { wallets: out } }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  },
}

export const WALLET_READ_TOOLS: Tool[] = [walletBalances]
