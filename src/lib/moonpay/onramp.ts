// Build a MoonPay hosted on-ramp ("buy crypto with card") URL prefilled with a
// destination wallet address. Mirrors what the MoonPay Agents deposit/onramp
// flow produces (walletAddress + redirectURL). Returns null when no MoonPay
// publishable key is configured — callers then fall back to deposit-by-address.
//
// Works on both server and client (reads a NEXT_PUBLIC_ env).

const MOONPAY_BUY_URL = 'https://buy.moonpay.com'

// Best-effort default asset per chain family (the user can change it in the
// widget). Omitted for unknown chains so MoonPay presents supported options.
const DEFAULT_CURRENCY_BY_CHAIN: Record<string, string> = {
  'eip155:8453': 'usdc_base',
  'eip155:1': 'usdc',
  'solana:mainnet': 'usdc_sol',
}

export function getMoonpayApiKey(): string | undefined {
  return process.env.NEXT_PUBLIC_MOONPAY_API_KEY
}

export function buildMoonpayOnrampUrl(opts: {
  address: string
  chain?: string | null
  redirectUrl?: string
}): string | null {
  const apiKey = getMoonpayApiKey()
  if (!apiKey || !opts.address) return null

  const params = new URLSearchParams({ apiKey, walletAddress: opts.address })
  const currency = opts.chain ? DEFAULT_CURRENCY_BY_CHAIN[opts.chain] : undefined
  if (currency) params.set('defaultCurrencyCode', currency)
  if (opts.redirectUrl) params.set('redirectURL', opts.redirectUrl)

  return `${MOONPAY_BUY_URL}?${params.toString()}`
}
