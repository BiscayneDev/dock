// USDC token contract addresses per chain (CAIP-2 chain IDs)
export const USDC_CONTRACTS: Record<string, string> = {
  'eip155:8453': '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',   // Base
  'eip155:1': '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',     // Ethereum
  'solana:mainnet': 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // Solana
}

export const SUPPORTED_CHAINS = Object.keys(USDC_CONTRACTS)

export const DEFAULT_CHAIN = 'eip155:8453' // Base — lowest fees

export const USDC_DECIMALS: Record<string, number> = {
  'eip155:8453': 6,
  'eip155:1': 6,
  'solana:mainnet': 6,
}

export const MIN_FEE_AMOUNT = 0.01   // $0.01 USDC minimum
export const MAX_FEE_AMOUNT = 100    // $100 USDC maximum

export const CURRENCY = 'USDC'

export function isEVMChain(chain: string): boolean {
  return chain.startsWith('eip155:')
}

export function isSolanaChain(chain: string): boolean {
  return chain.startsWith('solana:')
}

export function isSupportedChain(chain: string): boolean {
  return SUPPORTED_CHAINS.includes(chain)
}

// Convert human-readable amount to on-chain units
export function toOnChainAmount(amount: number, chain: string): bigint {
  const decimals = USDC_DECIMALS[chain] ?? 6
  return BigInt(Math.round(amount * 10 ** decimals))
}
