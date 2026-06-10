import { getPaymentFetch } from '@/lib/x402/client'
import { logger } from '@/lib/logger'
import type { UserContext } from '@/lib/llm/types'

// Thin client for MoonPay Agents (agents.moonpay.com) — the same first-party
// service the `@moonpay/cli` (`mp`) talks to. Tools are reached at
// POST /api/tools/<tool> and are x402-paid, so we authenticate/pay through
// Dock's existing x402 payment fetch (the user's connected wallet) — no merchant
// key required, exactly like running the CLI yourself.
//
// NOTE: the request/response contracts mirror the CLI's published tool schemas.
// The paid call requires a payment-capable wallet (x402) and should be
// smoke-tested live before being relied on.

const MOONPAY_AGENTS_BASE = 'https://agents.moonpay.com'

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

async function moonpayAgentCall<T>(ctx: UserContext, tool: string, body: Record<string, unknown>): Promise<T> {
  const payFetch = (await getPaymentFetch(ctx)) ?? fetch
  const res = await payFetch(`${MOONPAY_AGENTS_BASE}/api/tools/${encodeURIComponent(tool)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    logger.error('MoonPay Agents call failed', { tool, status: res.status, body: text.slice(0, 300) })
    throw new Error(`MoonPay Agents ${tool} failed (${res.status})`)
  }
  return res.json() as Promise<T>
}

export interface MoonpayDepositResult {
  // Multi-chain deposit addresses that auto-convert and settle to the wallet.
  addresses?: Record<string, string> | Array<{ chain: string; address: string }>
  [key: string]: unknown
}

// deposit_create: generate multi-chain deposit addresses (BTC/ETH/SOL/TRON …)
// that auto-convert and settle to the destination wallet/chain/token.
export async function createMultiChainDeposit(
  ctx: UserContext,
  opts: { wallet: string; chain: string; token?: string; name?: string }
): Promise<MoonpayDepositResult> {
  return moonpayAgentCall<MoonpayDepositResult>(ctx, 'deposit_create', {
    wallet: opts.wallet,
    chain: opts.chain,
    token: opts.token ?? 'USDC',
    name: opts.name ?? 'Dock wallet top-up',
  })
}

export interface MoonpayBuyResult {
  url: string
  [key: string]: unknown
}

// buy: generate a MoonPay fiat checkout URL the user opens in a browser.
export async function createBuyCheckout(
  ctx: UserContext,
  opts: { token: string; amount: number; wallet: string; email: string }
): Promise<MoonpayBuyResult> {
  return moonpayAgentCall<MoonpayBuyResult>(ctx, 'buy', {
    token: opts.token,
    amount: opts.amount,
    wallet: opts.wallet,
    email: opts.email,
  })
}
