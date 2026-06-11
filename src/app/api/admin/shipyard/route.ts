import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getAdminSession } from '@/lib/auth/admin'
import { logger } from '@/lib/logger'

export const dynamic = 'force-dynamic'

const USDC_MINT_DEFAULT = {
  devnet: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
  mainnet: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
} as const
const RPC_DEFAULT = {
  devnet: 'https://api.devnet.solana.com',
  mainnet: 'https://api.mainnet-beta.solana.com',
} as const

function settleNetwork(): 'devnet' | 'mainnet' {
  return process.env.SHIPYARD_SETTLE_NETWORK === 'mainnet' ? 'mainnet' : 'devnet'
}

/** Live treasury USDC balance from the chain, so the operator sees collected funds. */
async function treasuryBalance(): Promise<number | null> {
  const treasury = process.env.SHIPYARD_TREASURY_WALLET
  if (!treasury) return null
  const network = settleNetwork()
  const mint = process.env.SHIPYARD_SETTLE_USDC_MINT ?? USDC_MINT_DEFAULT[network]
  const rpc = process.env.SHIPYARD_SETTLE_RPC_URL ?? RPC_DEFAULT[network]
  try {
    const res = await fetch(rpc, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getTokenAccountsByOwner',
        params: [treasury, { mint }, { encoding: 'jsonParsed' }],
      }),
      // Don't let a slow RPC hang the dashboard.
      signal: AbortSignal.timeout(6000),
    })
    const json = await res.json()
    const accounts = json?.result?.value ?? []
    if (!accounts.length) return 0
    return Number(accounts[0]?.account?.data?.parsed?.info?.tokenAmount?.uiAmount ?? 0)
  } catch (err) {
    logger.error('treasury balance fetch failed', {
      error: err instanceof Error ? err.message : String(err),
    })
    return null
  }
}

export async function GET(): Promise<NextResponse> {
  const session = await getAdminSession()
  if (!session) {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
  }

  const supabase = createServerClient()
  const [{ data: overview, error }, balance] = await Promise.all([
    supabase.rpc('shipyard_admin_overview'),
    treasuryBalance(),
  ])
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({
    ...(overview as object),
    config: {
      network: settleNetwork(),
      treasury: process.env.SHIPYARD_TREASURY_WALLET ?? null,
      treasuryBalanceUsdc: balance,
      marginPct: Number(process.env.SHIPYARD_MARGIN_PCT ?? '15'),
      thresholdUsd: Number(process.env.SHIPYARD_SETTLE_THRESHOLD_USD ?? '1.00'),
    },
  })
}

/**
 * Operator action: release a failed/frozen settlement's billed rows back to
 * unsettled so they re-accrue and settle on the user's next message.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await getAdminSession()
  if (!session) {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
  }

  let body: { settlementId?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  if (!body.settlementId) {
    return NextResponse.json({ error: 'settlementId required' }, { status: 400 })
  }

  const supabase = createServerClient()
  const { data, error } = await supabase
    .from('inference_usage')
    .update({ settlement_id: null, settled_at: null })
    .eq('settlement_id', body.settlementId)
    .select('id')
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ released: (data ?? []).length })
}
