/**
 * Keep-warm (cron, every 5 minutes): one trivial authenticated round trip
 * keeps the lambda and the Supabase connection hot, so the first real
 * message after an idle spell avoids the cold-start second.
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
    return NextResponse.json({ warm: !error })
}
