/**
 * Spectrum sweep (cron, every minute): retries the outbound queue and
 * delivers pending Google-connect resumes. Stateless replacement for the
 * VPS process's 15s resume poll and its (nonexistent) send retry.
 *
 * Both halves reuse the #21 lease patterns: outbox rows are lease-claimed
 * via claim_spectrum_outbox (migration 015), resumes via claimPendingResume.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getSpectrumApp, getImessage } from '@/lib/spectrum/app'
import { claimOutboxBatch, markOutboxFailed, markOutboxSent } from '@/lib/spectrum/outbox'
import { chat, MAX_HISTORY } from '@/lib/spectrum/dinghy'
import { GATEWAY_URL, SHIPYARD_API_KEY, SHIPYARD_MODEL } from '@/lib/spectrum/config'
import {
    ackResume,
    claimPendingResume,
    listUnresumedResumeChats,
    loadHistory,
    saveMessage,
} from '@/spectrum/store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function GET(request: NextRequest): Promise<NextResponse> {
    if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    let app
    try {
        app = await getSpectrumApp()
    } catch (err) {
        // Pre-cutover the signing secret is not set yet; nothing can have
        // arrived, so a quiet skip beats cron error noise.
        console.error('spectrum sweep skipped:', err instanceof Error ? err.message : String(err))
        return NextResponse.json({ skipped: true })
    }
    const im = await getImessage(app)

    const results = { outboxSent: 0, outboxRetried: 0, resumes: 0 }

    for (const row of await claimOutboxBatch()) {
        try {
            const space = await im.space.get(row.chat_guid)
            await space.send(row.text)
            await markOutboxSent(row.id)
            results.outboxSent++
        } catch (err) {
            console.error(`outbox send failed (${row.kind} → ${row.chat_guid}):`, err instanceof Error ? err.message : String(err))
            await markOutboxFailed(row, err)
            results.outboxRetried++
        }
    }

    if (SHIPYARD_API_KEY) {
        for (const guid of await listUnresumedResumeChats().catch(() => [] as string[])) {
            const claimed = await claimPendingResume(guid)
            if (!claimed) continue
            try {
                const history = await loadHistory(guid, MAX_HISTORY)
                history.push({ role: 'user', content: claimed.pendingRequest })
                const reply = await chat(history, {
                    gatewayUrl: GATEWAY_URL,
                    apiKey: SHIPYARD_API_KEY,
                    model: SHIPYARD_MODEL,
                })
                const space = await im.space.get(guid)
                await space.send(`google connected ✓\n\n${reply}`)
                await ackResume(claimed.id) // ack ONLY after a successful send
                await saveMessage(guid, 'user', claimed.pendingRequest)
                await saveMessage(guid, 'assistant', reply)
                results.resumes++
            } catch (err) {
                // Leave the lease un-acked: it expires and the next sweep retries.
                console.error(`resume delivery failed (${guid}):`, err instanceof Error ? err.message : String(err))
            }
        }
    }

    return NextResponse.json(results)
}
