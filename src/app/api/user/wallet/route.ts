import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { createServerClient } from '@/lib/supabase/server'
import {
  getDecryptedOWSTokens,
  getOWSClient,
} from '@/lib/integrations/openwallet'
import { logger } from '@/lib/logger'

const CHAIN_LABELS: Record<string, string> = {
  'eip155:8453': 'Base',
  'eip155:1': 'Ethereum',
  'solana:mainnet': 'Solana',
}

// GET wallet status, address, and USDC balance
export async function GET(): Promise<NextResponse> {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createServerClient()
  const { data: user } = await supabase
    .from('users')
    .select('wallet_address, wallet_chain')
    .eq('id', session.userId)
    .single()

  // Check if OWS credentials exist
  const tokens = await getDecryptedOWSTokens(session.userId)

  if (!tokens || !user?.wallet_address) {
    return NextResponse.json({
      connected: false,
      address: null,
      chain: null,
      chainLabel: null,
      balance: null,
    })
  }

  const chain = (user.wallet_chain as string) ?? 'eip155:8453'

  // Try to fetch balance from OWS
  let balance: { usdc: string; raw: string } | null = null

  try {
    const client = getOWSClient(tokens)
    const walletsRes = await client.listWallets()

    if (walletsRes.ok && walletsRes.data) {
      const wallets = walletsRes.data as Array<{ id: string }>

      if (wallets.length > 0) {
        const accountsRes = await client.listAccounts(wallets[0].id)

        if (accountsRes.ok && accountsRes.data) {
          const accounts = accountsRes.data as Array<{ id: string; address: string; chain?: string }>

          // Find the account matching the stored chain
          const account = accounts.find((a) => a.chain === chain) ?? accounts[0]

          if (account) {
            const balanceRes = await client.getBalance(account.id, chain)

            if (balanceRes.ok && balanceRes.data) {
              const balData = balanceRes.data as Record<string, unknown>
              // OWS returns balance in various formats — extract USDC amount
              const rawBalance = String(balData.balance ?? balData.amount ?? '0')
              const decimals = 6 // USDC always 6 decimals
              const numericBalance = Number(rawBalance) / 10 ** decimals

              balance = {
                usdc: numericBalance.toFixed(2),
                raw: rawBalance,
              }
            }
          }
        }
      }
    }
  } catch (err) {
    logger.error('Failed to fetch wallet balance', {
      userId: session.userId,
      error: err instanceof Error ? err.message : String(err),
    })
    // Non-fatal — return connected status without balance
  }

  return NextResponse.json({
    connected: true,
    address: user.wallet_address as string,
    chain,
    chainLabel: CHAIN_LABELS[chain] ?? chain,
    balance,
  })
}
