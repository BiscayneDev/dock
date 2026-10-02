import { beforeEach, describe, expect, it, vi } from 'vitest'
const { tokens, access, credentials, portfolio } = vi.hoisted(() => ({ tokens: vi.fn(), access: vi.fn(), credentials: vi.fn(), portfolio: vi.fn() }))
vi.mock('@/lib/integrations/paybox', () => ({ getPayboxTokensForUser: tokens, getPayboxAccessToken: access, getPayboxApiUrl: () => 'https://api.paybox.sh' }))
vi.mock('@paybox-sh/sdk', () => ({ PayboxClient: class { listCredentials = credentials; getPortfolio = portfolio } }))
import { readPortfolio } from '@/lib/profile/paybox-read'
const wallet = (id: string, address: string | null) => ({ credential: { id, name: id, credential_type: 'wallet', metadata: { address }, disabled_at: null }, grant: {} })
beforeEach(() => { tokens.mockReset().mockResolvedValue({ accessToken: 'private' }); access.mockReset().mockResolvedValue('private'); credentials.mockReset(); portfolio.mockReset().mockResolvedValue({ holdings: [], total_usd: 0 }) })
describe('read-only PayBox adapter', () => {
  it('does no portfolio calls without a connection', async () => { tokens.mockResolvedValue(null); expect((await readPortfolio('owner')).state).toBe('disconnected'); expect(credentials).not.toHaveBeenCalled() })
  it('deduplicates shared EVM addresses and filters disabled/card credentials', async () => {
    credentials.mockResolvedValue({ credentials: [wallet('a', '0xAb'), wallet('b', '0xab'), { ...wallet('c', '0xCD'), credential: { ...wallet('c', '0xCD').credential, disabled_at: 'today' } }, { ...wallet('card', '0xFF'), credential: { ...wallet('card', '0xFF').credential, credential_type: 'card' } }] })
    const result = await readPortfolio('owner'); expect(result.wallets).toHaveLength(1); expect(portfolio).toHaveBeenCalledTimes(1); expect(tokens).toHaveBeenCalledWith('owner')
  })
  it('never falls back to someone else or a legacy default wallet', async () => { credentials.mockResolvedValue({ credentials: [] }); expect((await readPortfolio('owner')).state).toBe('no_wallets'); expect(portfolio).not.toHaveBeenCalled() })
  it('isolates a provider failure per wallet and caps reads', async () => { credentials.mockResolvedValue({ credentials: Array.from({ length: 14 }, (_, i) => wallet(String(i), `0x${i}`)) }); portfolio.mockRejectedValue(new Error('provider secret')); const result = await readPortfolio('owner'); expect(portfolio).toHaveBeenCalledTimes(12); expect(result.truncated).toBe(true); expect(result.wallets.every(w => w.status === 'unavailable' && w.totalUsd === null)).toBe(true); expect(JSON.stringify(result)).not.toContain('secret') })
})
