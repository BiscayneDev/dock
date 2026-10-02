/** Read-only display contract. Unknown payloads never become a zero balance. */
export type Holding = { symbol: string; name: string; network: string; amount: string | null; usd: number | null }
export type Wallet = { name: string; address: string | null; totalUsd: number | null; holdings: Holding[]; status: 'ready' | 'partial' | 'unavailable'; asOf: string | null }
export type Portfolio = { state: 'ready' | 'disconnected' | 'no_wallets' | 'error'; wallets: Wallet[]; checkedAt: string; truncated?: boolean }
const number = (v: unknown): number | null => typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null
const record = (v: unknown): Record<string, unknown> | null => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null
const date = (v: unknown): string | null => typeof v === 'string' && Number.isFinite(Date.parse(v)) ? v : null
export function normalizePortfolio(raw: unknown): Pick<Wallet, 'holdings' | 'totalUsd' | 'status' | 'asOf'> {
  const r = record(raw)
  if (!r || !Array.isArray(r.holdings)) throw new Error('Unsupported PayBox portfolio response')
  const holdings = r.holdings.map((value): Holding => {
    const h = record(value)
    if (!h || typeof h.symbol !== 'string') throw new Error('Unsupported PayBox holding')
    // Preserve token quantities as strings; never apply guessed decimals to raw balances.
    return { symbol: h.symbol, name: typeof h.name === 'string' ? h.name : h.symbol,
      network: String(h.network_id ?? h.networkId ?? ''),
      amount: typeof h.display_balance === 'string' ? h.display_balance : typeof h.displayBalance === 'string' ? h.displayBalance : null,
      usd: number(h.balanceUsd ?? h.balance_usd) }
  })
  if (r.total_usd !== null && number(r.total_usd) === null) throw new Error('Missing PayBox total')
  const partial = r.total_usd === null || holdings.some(h => h.usd === null)
  const freshness = record(r.freshness)
  return { holdings: holdings.sort((a, b) => (b.usd ?? -1) - (a.usd ?? -1)),
    totalUsd: partial ? null : number(r.total_usd), status: partial ? 'partial' : 'ready',
    asOf: date(r.as_of ?? freshness?.as_of) }
}
export function walletKey(address: string): string { return address.startsWith('0x') ? address.toLowerCase() : address }
export function portfolioTotal(wallets: Wallet[]): number | null {
  return wallets.length && wallets.every(w => w.status === 'ready' && w.totalUsd !== null)
    ? wallets.reduce((sum, w) => sum + w.totalUsd!, 0) : null
}
export function chainName(id: string): string {
  return ({ '1': 'Ethereum', '8453': 'Base', '137': 'Polygon', 'eip155:1': 'Ethereum', 'eip155:8453': 'Base', 'solana': 'Solana', 'solana-mainnet': 'Solana' } as Record<string, string>)[id] ?? id
}
