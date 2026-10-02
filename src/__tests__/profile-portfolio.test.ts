import { describe, expect, it } from 'vitest'
import { normalizePortfolio, walletKey, portfolioTotal } from '@/lib/profile/portfolio'
import { fileLinkState, safeFileUrl } from '@/lib/profile/file-display'

describe('wallet display is fail-closed', () => {
  it('keeps verified zero separate from malformed payload', () => {
    expect(normalizePortfolio({ holdings: [], total_usd: 0 }).totalUsd).toBe(0)
    expect(() => normalizePortfolio({ balances: [], totalUsd: 0 })).toThrow()
    expect(() => normalizePortfolio({ holdings: [] })).toThrow()
  })
  it('does not use unknown prices to invent a total', () => {
    expect(normalizePortfolio({ holdings: [{ symbol: 'ABC', balanceUsd: null }], total_usd: 99 }).totalUsd).toBeNull()
    expect(normalizePortfolio({ holdings: [], total_usd: null }).status).toBe('partial')
  })
  it('rejects nonfinite and negative totals', () => {
    for (const n of [NaN, Infinity, -1, '10']) expect(() => normalizePortfolio({ holdings: [], total_usd: n })).toThrow()
  })
  it('never guesses decimals from raw token quantities', () => {
    expect(normalizePortfolio({ holdings: [{ symbol: 'USDC', balance: '10000000', balanceUsd: 10 }], total_usd: 10 }).holdings[0].amount).toBeNull()
  })
  it('preserves source freshness, not response-check time', () => {
    expect(normalizePortfolio({ holdings: [], total_usd: 0, freshness: { as_of: '2026-10-02T12:00:00Z' } }).asOf).toBe('2026-10-02T12:00:00Z')
  })
  it('dedupes EVM casing, preserving case-sensitive Solana keys', () => {
    expect(walletKey('0xAbCd')).toBe(walletKey('0xabcd'))
    expect(walletKey('AbCd')).not.toBe(walletKey('abcd'))
  })
  it('does not sum unavailable or partially priced wallets', () => {
    const wallet = { name: 'Wallet', address: '0x1', ...normalizePortfolio({ holdings: [], total_usd: 12 }) }
    expect(portfolioTotal([wallet, { ...wallet, status: 'unavailable' }])).toBeNull()
    expect(portfolioTotal([])).toBeNull()
    expect(portfolioTotal([wallet])).toBe(12)
  })
})
describe('file link display', () => {
  it('does not activate expired links', () => expect(fileLinkState({ url: 'https://boat.here.now/', expires_at: '2026-10-01T12:00:00Z', revoked_at: null }, Date.parse('2026-10-02T12:00:00Z'))).toBe('expired'))
  it('revocation wins over a valid URL', () => expect(fileLinkState({ url: 'https://boat.here.now/', expires_at: null, revoked_at: '2026-10-01' })).toBe('revoked'))
  it('private records have no shared link', () => expect(fileLinkState({ url: null, expires_at: null, revoked_at: null })).toBe('private'))
  it('rejects executable URL schemes', () => { expect(safeFileUrl('javascript:alert(1)')).toBeNull(); expect(safeFileUrl('data:text/html,test')).toBeNull() })
})
