import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth/session'
import {
  storeOWSCredentials,
  removeOWSCredentials,
  OWSClient,
  extractWalletAddress,
  storeWalletAddress,
} from '@/lib/integrations/openwallet'

const ConnectBody = z.object({
  endpoint: z.string().url().describe('OWS instance URL (e.g. http://localhost:8787)'),
  apiKey: z.string().min(1).describe('OWS API key'),
})

// Connect MoonPay Wallet (OWS-compatible)
export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = ConnectBody.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', issues: parsed.error.issues }, { status: 400 })
  }

  // Verify the credentials work by listing wallets
  const client = new OWSClient({
    endpoint: parsed.data.endpoint,
    apiKey: parsed.data.apiKey,
  })

  const testResult = await client.listWallets()
  if (!testResult.ok) {
    return NextResponse.json(
      { error: `Could not connect to wallet: ${testResult.error}` },
      { status: 400 }
    )
  }

  try {
    await storeOWSCredentials(session.userId, parsed.data.apiKey, parsed.data.endpoint)

    // Extract and store the wallet address for receiving payments
    const walletInfo = await extractWalletAddress(client)
    if (walletInfo) {
      await storeWalletAddress(session.userId, walletInfo.address, walletInfo.chain)
    }

    return NextResponse.json({
      success: true,
      walletAddress: walletInfo?.address ?? null,
      walletChain: walletInfo?.chain ?? null,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

// Disconnect wallet
export async function DELETE(): Promise<NextResponse> {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    await removeOWSCredentials(session.userId)
    return NextResponse.json({ success: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
