/**
 * Keep-warm (cron, every 5 minutes): one trivial authenticated round trip
 * keeps this lambda and the Supabase connection hot, and an unsigned POST
 * at the Spectrum webhook route keeps THAT lambda warm too — the route
 * initializes the Spectrum app (SDK auth token fetch) before rejecting the
 * bad signature, so the app singleton + token cache stay pinned in a live
 * instance and warm-path replies skip the ~60s cold start.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest): Promise<NextResponse> {
    if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const supabase = createServerClient()
    const { error } = await supabase.from('spectrum_inbound_dedupe').select('message_id').limit(1)

    let webhookWarm = false
    const appUrl = process.env.NEXT_PUBLIC_APP_URL
    if (appUrl) {
        try {
            // Unsigned on purpose: the SDK rejects it (400, or 401 on older
            // builds). The warm-up is the app init the route performs before
            // verification, so any rejection means the function is warm.
            const res = await fetch(`${appUrl}/api/spectrum/webhook`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: '{}',
            })
            webhookWarm = res.status === 400 || res.status === 401
        } catch (err) {
            console.error('webhook warm failed:', err instanceof Error ? err.message : String(err))
        }
    }
    return NextResponse.json({ warm: !error, webhookWarm })
}
