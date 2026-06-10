import type { PayboxClient } from '@paybox-sh/sdk'

// Thin client for MoonPay Agents (agents.moonpay.com) — the same first-party
// service the `@moonpay/cli` (`mp`) talks to. Tools are reached at
// POST /api/tools/<tool> and are x402-paid. We pay through the user's Paybox
// wallet via the SDK's `useService` gateway (Paybox probes the url, pays the
// 402 from the wallet credential, re-fetches, and returns the reply) — no
// merchant key, the same way the CLI works, and on the rail we steer users to.
//
// NOTE: the request/response contracts mirror the CLI's published tool schemas;
// the paid x402 calls should be smoke-tested live before being relied on.

const MOONPAY_AGENTS_BASE = 'https://agents.moonpay.com'

type X402Result = Awaited<ReturnType<PayboxClient['useService']>>

// Map our CAIP-2 chain ids to MoonPay Agents' chain enum
// (solana | ethereum | base | polygon | arbitrum | bnb).
const CHAIN_MAP: Record<string, string> = {
  'eip155:8453': 'base',
  'eip155:1': 'ethereum',
  'eip155:137': 'polygon',
  'eip155:42161': 'arbitrum',
  'eip155:56': 'bnb',
  'solana:mainnet': 'solana',
}

export function toMoonpayChain(chain: string | null | undefined): string | null {
  if (!chain) return null
  return CHAIN_MAP[chain] ?? null
}

function moonpayUseService(
  sdk: PayboxClient,
  credentialId: string,
  tool: string,
  body: Record<string, unknown>
): Promise<X402Result> {
  return sdk.useService({
    credentialId,
    url: `${MOONPAY_AGENTS_BASE}/api/tools/${tool}`,
    method: 'POST',
    body,
  })
}

// deposit_create: generate multi-chain deposit addresses (BTC/ETH/SOL/TRON …)
// that auto-convert and settle to the destination wallet/chain/token.
export function createMultiChainDeposit(
  sdk: PayboxClient,
  credentialId: string,
  opts: { wallet: string; chain: string; token?: string; name?: string }
): Promise<X402Result> {
  return moonpayUseService(sdk, credentialId, 'deposit_create', {
    wallet: opts.wallet,
    chain: opts.chain,
    token: opts.token ?? 'USDC',
    name: opts.name ?? 'Dock wallet top-up',
  })
}

// buy: generate a MoonPay fiat checkout URL the user opens in a browser.
export function createBuyCheckout(
  sdk: PayboxClient,
  credentialId: string,
  opts: { token: string; amount: number; wallet: string; email: string }
): Promise<X402Result> {
  return moonpayUseService(sdk, credentialId, 'buy', {
    token: opts.token,
    amount: opts.amount,
    wallet: opts.wallet,
    email: opts.email,
  })
}
