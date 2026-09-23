import { describe, it, expect, vi, afterEach } from 'vitest'
import { getTokenUsdPrice, nativeSymbolForChain } from '@/lib/tools/crypto'

describe('nativeSymbolForChain', () => {
  it('maps CAIP-2 chains to native symbols', () => {
    expect(nativeSymbolForChain('eip155:1')).toBe('eth')
    expect(nativeSymbolForChain('eip155:8453')).toBe('eth')
    expect(nativeSymbolForChain('solana:mainnet-beta')).toBe('sol')
    expect(nativeSymbolForChain('bip122:000000000019d6689c085ae165831e93')).toBe('btc')
  })

  it('falls back to the chain namespace tail for unknown chains', () => {
    expect(nativeSymbolForChain('cosmos:cosmoshub-4')).toBe('cosmoshub-4')
  })
})

describe('getTokenUsdPrice', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('returns the usd price from the simple/price endpoint', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ solana: { usd: 212.5 } }), { status: 200 })
    ))
    await expect(getTokenUsdPrice('SOL')).resolves.toBe(212.5)
    const calledWith = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    expect(calledWith).toContain('ids=solana')
    expect(calledWith).toContain('vs_currencies=usd')
  })

  it('maps symbols to coingecko ids', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ ethereum: { usd: 4000 } }), { status: 200 })
    ))
    await expect(getTokenUsdPrice('eth')).resolves.toBe(4000)
  })

  it('returns null on http error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 429 })))
    await expect(getTokenUsdPrice('SOL')).resolves.toBeNull()
  })

  it('returns null on network failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    await expect(getTokenUsdPrice('SOL')).resolves.toBeNull()
  })

  it('returns null on malformed payloads', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ solana: {} }), { status: 200 })
    ))
    await expect(getTokenUsdPrice('SOL')).resolves.toBeNull()
  })
})
