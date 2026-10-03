import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createConnectLink } from '@/spectrum/store'
import { chatGuidForPhone } from '@/lib/spectrum/waitlist-invites'
import { startGoogleEligible, START_CONNECT_REQUEST } from '@/lib/spectrum/start-link'

export const dynamic = 'force-dynamic'

/**
 * Connect Google from the web start page, before the first text. The start
 * token is the secret that proves who this is: it maps to one waitlist row and
 * one phone. We mint the normal one-use connect link for that phone's chat and
 * send the browser to it. The same connect flow then binds the identity (the
 * allowlist gate still applies) and the sweep sends the connected line, the
 * first finding and the research digest to their phone, no text needed first.
 * Anything off (bad token, no phone, not allowlisted) goes back to the start
 * page, where the text-first path still works.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }): Promise<NextResponse> {
  const { token } = await params
  const back = new URL(`/start/${encodeURIComponent(token)}`, request.url)
  if (!/^[A-Za-z0-9_-]{32}$/.test(token)) return NextResponse.redirect(back)
  try {
    const db = createServerClient()
    const { data } = await db.from('waitlist').select('phone, status, start_token').eq('start_token', token).maybeSingle()
    if (!startGoogleEligible(data)) return NextResponse.redirect(back)
    const chatGuid = chatGuidForPhone(data!.phone as string)
    const { data: allowed } = await db.from('beta_allowlist').select('chat_guid').eq('chat_guid', chatGuid).maybeSingle()
    if (!allowed) return NextResponse.redirect(back)
    const link = await createConnectLink(chatGuid, START_CONNECT_REQUEST)
    return NextResponse.redirect(link)
  } catch (err) {
    console.error('start google connect failed:', err instanceof Error ? err.message : String(err))
    return NextResponse.redirect(back)
  }
}
