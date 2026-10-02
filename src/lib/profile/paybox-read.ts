import { PayboxClient } from '@paybox-sh/sdk'
import { getPayboxTokensForUser, getPayboxAccessToken, getPayboxApiUrl } from '@/lib/integrations/paybox'
import { normalizePortfolio, walletKey, type Portfolio, type Wallet } from './portfolio'

/** No signing key is loaded, and no write-capable operation is called. */
export async function readPortfolio(userId: string): Promise<Portfolio> {
  const checkedAt = new Date().toISOString()
  const tokens = await getPayboxTokensForUser(userId)
  if (!tokens) return { state: 'disconnected', wallets: [], checkedAt }
  const sdk = new PayboxClient({ baseUrl: getPayboxApiUrl(), token: await getPayboxAccessToken(tokens, userId) })
  const list = await sdk.listCredentials()
  const seen = new Set<string>()
  const wallets = list.credentials.filter(({ credential: c }) => {
    if (c.credential_type !== 'wallet' || c.disabled_at) return false
    const address = typeof c.metadata?.address === 'string' ? c.metadata.address : null
    const key = address ? walletKey(address) : c.id
    if (seen.has(key)) return false
    seen.add(key); return true
  })
  if (!wallets.length) return { state: 'no_wallets', wallets: [], checkedAt }
  const result: Wallet[] = []
  // Bound fan-out: at most two simultaneous reads and twelve wallet calls.
  const selected = wallets.slice(0, 12)
  for (let i = 0; i < selected.length; i += 2) {
    result.push(...await Promise.all(selected.slice(i, i + 2).map(async ({ credential: c }): Promise<Wallet> => {
      const address = typeof c.metadata?.address === 'string' ? c.metadata.address : null
      const base = { name: c.name, address }
      try {
        if (!address) throw new Error('No address')
        return { ...base, ...normalizePortfolio(await sdk.getPortfolio({ address })) }
      } catch {
        return { ...base, holdings: [], totalUsd: null, status: 'unavailable', asOf: null }
      }
    })))
  }
  return { state: 'ready', wallets: result, checkedAt, truncated: wallets.length > 12 }
}
