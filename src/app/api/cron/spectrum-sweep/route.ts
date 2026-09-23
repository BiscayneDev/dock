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
import { chat, chatWithTools, MAX_HISTORY } from '@/lib/spectrum/dinghy'
import { capabilitiesFor, loadImessageToolContext, toolsFor } from '@/lib/spectrum/imessage-tools'
import { GATEWAY_URL, SHIPYARD_API_KEY, SHIPYARD_MODEL } from '@/lib/spectrum/config'
import { typing } from 'spectrum-ts'
import {
    ackResume,
    claimPendingResume,
    listUnresumedResumeChats,
    loadFacts,
    loadHistory,
    saveMessage,
    type DinghyFact,
    type HistoryMessage,
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
        const facts = await loadFacts().catch((err) => {
            console.error('facts load failed:', err instanceof Error ? err.message : String(err))
            return [] as DinghyFact[]
        })
        const resumeChats = await listUnresumedResumeChats().catch((err) => {
            console.error('resume chat list failed:', err instanceof Error ? err.message : String(err))
            return [] as string[]
        })
        for (const guid of resumeChats) {
            const claimed = await claimPendingResume(guid).catch((err) => {
                console.error(`resume claim failed (${guid}):`, err instanceof Error ? err.message : String(err))
                return null
            })
            if (!claimed) {
                console.error(`resume claim returned null (${guid})`)
                continue
            }
            try {
                // A DB blip degrades to no-history, never a dead resume.
                const history = await loadHistory(guid, MAX_HISTORY).catch((err) => {
                    console.error('resume history load failed:', err instanceof Error ? err.message : String(err))
                    return [] as HistoryMessage[]
                })
                history.push({ role: 'user', content: claimed.pendingRequest })
                const space = await im.space.get(guid)
                void space.send(typing()).catch(() => {})
                // Freshly connected chats resume their original request —
                // with tools when the binding is in place.
                const toolCtx = await loadImessageToolContext(guid).catch(() => null)
                const tools = toolCtx ? toolsFor(toolCtx) : []
                const reply = toolCtx && tools.length > 0
                    ? (
                          await chatWithTools(
                              history,
                              {
                                  gatewayUrl: GATEWAY_URL,
                                  apiKey: SHIPYARD_API_KEY,
                                  model: SHIPYARD_MODEL,
                                  facts,
                                  capabilities: capabilitiesFor(toolCtx),
                              },
                              tools,
                              toolCtx
                          )
                      ).reply
                    : await chat(history, {
                          gatewayUrl: GATEWAY_URL,
                          apiKey: SHIPYARD_API_KEY,
                          model: SHIPYARD_MODEL,
                          facts,
                      })
                // Halsey, 2026-09-22: the follow-up must say he's connected,
                // then resume his original request.
                const connectedLine =
                    claimed.provider === 'paybox'
                        ? "paybox is connected — i can see your wallet balances now (read-only) ✓"
                        : "you're connected — gmail + calendar are in ✓"
                await space.send(`${connectedLine}\n\n${reply}`)
                void space.send(typing('stop')).catch(() => {})
                await ackResume(claimed.id) // ack ONLY after a successful send
                await saveMessage(guid, 'user', claimed.pendingRequest).catch((err) =>
                    console.error('resume message save failed:', err instanceof Error ? err.message : String(err))
                )
                await saveMessage(guid, 'assistant', reply).catch((err) =>
                    console.error('resume message save failed:', err instanceof Error ? err.message : String(err))
                )
                results.resumes++
            } catch (err) {
                // Leave the lease un-acked: it expires and the next sweep retries.
                console.error(`resume delivery failed (${guid}):`, err instanceof Error ? err.message : String(err))
            }
        }
    }

    return NextResponse.json(results)
}
