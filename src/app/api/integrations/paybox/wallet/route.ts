import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import {
  getDecryptedPayboxTokens,
  getPayboxSdk,
  getPayboxWallets,
} from '@/lib/integrations/paybox'
import { logger } from '@/lib/logger'

// Return the user's Paybox wallet credentials (address + chains) for the
// deposit / top-up flow.
export async function GET(): Promise<NextResponse> {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const tokens = await getDecryptedPayboxTokens(session.userId)
  if (!tokens) {
    return NextResponse.json({ connected: false, wallets: [] })
  }

  try {
    const sdk = await getPayboxSdk(tokens, session.userId)
    const wallets = await getPayboxWallets(sdk)
    return NextResponse.json({ connected: true, wallets })
  } catch (err) {
    logger.error('Failed to load Paybox wallets', {
      error: err instanceof Error ? err.message : String(err),
    })
    return NextResponse.json({ connected: true, wallets: [], error: 'Could not load wallets' })
  }
}
