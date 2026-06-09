import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createServerClient } from '@/lib/supabase/server'
import { getSession } from '@/lib/auth/session'
import { storePayboxSigningKey, removePayboxSigningKey } from '@/lib/integrations/paybox'

const Body = z.object({
  // pbxk1. signing key minted in the Paybox app, scoped to the granted wallets.
  signingKey: z.string().regex(/^pbxk1\./, 'Must be a pbxk1. signing key'),
})

// Store a Paybox in-process wallet signing key. Requires Paybox to be connected
// (the key lives on the paybox token row).
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

  const parsed = Body.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', issues: parsed.error.issues }, { status: 400 })
  }

  // Must have connected Paybox first (the key attaches to that row).
  const supabase = createServerClient()
  const { data: row } = await supabase
    .from('oauth_tokens')
    .select('user_id')
    .eq('user_id', session.userId)
    .eq('provider', 'paybox')
    .single()

  if (!row) {
    return NextResponse.json(
      { error: 'Connect Paybox before adding a signing key.' },
      { status: 400 }
    )
  }

  try {
    await storePayboxSigningKey(session.userId, parsed.data.signingKey)
    return NextResponse.json({ success: true, canSign: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

// Remove the signing key (sign/swap then stall at pending_signature).
export async function DELETE(): Promise<NextResponse> {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    await removePayboxSigningKey(session.userId)
    return NextResponse.json({ success: true, canSign: false })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
