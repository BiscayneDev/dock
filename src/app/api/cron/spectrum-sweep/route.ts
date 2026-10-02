/**
 * Spectrum sweep (cron, every minute): retries the outbound queue and
 * delivers pending Google-connect resumes. Stateless replacement for the
 * VPS process's 15s resume poll and its (nonexistent) send retry.
 *
 * Both halves reuse the #21 lease patterns: outbox rows are lease-claimed
 * via claim_spectrum_outbox (migration 015), resumes via claimPendingResume.
 */

import { googleAccountsOf } from '@/lib/integrations/google-accounts'
import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getSpectrumApp, getImessage } from '@/lib/spectrum/app'
import { claimOutboxBatch, markOutboxFailed, markOutboxSent } from '@/lib/spectrum/outbox'
import { chat, chatWithTools, MAX_HISTORY, wantsAnotherGoogle } from '@/lib/spectrum/dinghy'
import { googleConnectedLine, isConnectRequest } from '@/lib/spectrum/connect-lines'
import { readFirstFinding } from '@/lib/spectrum/first-finding'
import { runConnectResearch } from '@/lib/spectrum/connect-research'
import { capabilitiesFor, loadImessageToolContext, toolsFor } from '@/lib/spectrum/imessage-tools'
import { actionToolsFor, renderProposal } from '@/lib/spectrum/actions'
import { allowanceUsedUpMessage, claimLimitNotice, isOverDailyAllowance } from '@/lib/allowance'
import { recordUsage, type GatewayUsage } from '@/lib/spectrum/metering'
import { GATEWAY_URL, SHIPYARD_API_KEY, SHIPYARD_MODEL } from '@/lib/spectrum/config'
import { typing } from 'spectrum-ts'
import { sendFileWithPreview } from '@/lib/files/send'
import { demoSpace, isDemoGuid } from '@/lib/spectrum/demo-chat'
import { sendBrief, type BriefPayload } from '@/lib/spectrum/brief-card-send'
import { renderFile } from '@/lib/files/render'
import { parseFileInput } from '@/lib/files/tool'
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
import { toPlainText } from '@/lib/spectrum/plain-text'

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
            const space = isDemoGuid(row.chat_guid) ? demoSpace(row.chat_guid, { persist: true }) : await im.space.get(row.chat_guid)
            if (row.kind === 'file') {
                // text is the JSON document; render and send as an attachment.
                const parsed = parseFileInput(JSON.parse(row.text))
                if ('error' in parsed) throw new Error(`bad file row: ${parsed.error}`)
                const file = await renderFile(parsed.doc, parsed.format, { ogImage: 'https://www.getdinghy.sh/api/og' })
                await sendFileWithPreview(space, { ...file, format: parsed.format, title: parsed.doc.title, subtitle: parsed.doc.subtitle })
                await saveMessage(row.chat_guid, 'assistant', `[file: ${parsed.doc.title}] sent as a ${parsed.format} attachment`).catch(() => undefined)
            } else if (row.kind === 'brief') {
                // text is JSON {card, text}: the card, or the text if it can't render.
                const payload = JSON.parse(row.text) as BriefPayload
                await sendBrief(space, payload)
                await saveMessage(row.chat_guid, 'assistant', payload.text).catch(() => undefined)
            } else {
                await space.send(toPlainText(row.text))
                // Reminders are server-initiated; keep them in history so a
                // follow-up ("snooze that") has context.
                if (row.kind === 'reminder') await saveMessage(row.chat_guid, 'assistant', row.text).catch(() => undefined)
            }
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
                const space = isDemoGuid(guid) ? demoSpace(guid, { persist: true }) : await im.space.get(guid)
                // A pending request that was itself "connect my gmail" is done once the
                // connect lands: confirm only. Replaying it re-answers a finished request
                // (and races the user's own next message).
                const connectOnly = claimed.provider === 'google' && isConnectRequest(claimed.pendingRequest)
                if (connectOnly) {
                    const toolCtxC = await loadImessageToolContext(guid).catch(() => null)
                    const line = googleConnectedLine(toolCtxC, wantsAnotherGoogle(claimed.pendingRequest))
                    await space.send(toPlainText(line))
                    await ackResume(claimed.id)
                    await saveMessage(guid, 'assistant', line).catch((err) =>
                        console.error('resume message save failed:', err instanceof Error ? err.message : String(err))
                    )
                    // One real finding, right now. Silent when there is nothing real.
                    if (toolCtxC?.tokens.google && claimed.provider === 'google') {
                        const finding = await readFirstFinding(toolCtxC.tokens.google, toolCtxC.userId, toolCtxC.timezone).catch((err) => {
                            console.error('first finding failed:', err instanceof Error ? err.message : String(err))
                            return null
                        })
                        if (finding) {
                            await space.send(toPlainText(finding))
                            await saveMessage(guid, 'assistant', finding, true).catch(() => {})
                        }
                        // Then start getting to know them: headers-only read of calendar
                        // and mail, a short summary, a few saved notes. First connect only.
                        if (!wantsAnotherGoogle(claimed.pendingRequest)) {
                            await runConnectResearch({
                                chatGuid: guid,
                                userId: toolCtxC.userId,
                                tokens: toolCtxC.tokens.google,
                                tz: toolCtxC.timezone,
                                say: async (t) => {
                                    await space.send(toPlainText(t))
                                    await saveMessage(guid, 'assistant', t, true).catch(() => {})
                                },
                            })
                        }
                    }
                    results.resumes++
                    continue
                }
                // Freshly connected chats resume their original request —
                // with tools when the binding is in place.
                const toolCtx = await loadImessageToolContext(guid).catch(() => null)
                // Halsey, 2026-09-22: the follow-up must say he's connected,
                // then resume his original request.
                const connectedLine =
                    claimed.provider === 'paybox'
                        ? "paybox is connected — i can see your wallet balances now (read-only) ✓"
                        : claimed.provider === 'github'
                          ? "github is connected — i can read your repos, issues and PRs now ✓"
                          : claimed.provider === 'oura' || claimed.provider === 'whoop'
                            ? `${claimed.provider === 'oura' ? 'oura' : 'whoop'} is connected — i can see your sleep, recovery and activity now ✓`
                          : googleConnectedLine(toolCtx, wantsAnotherGoogle(claimed.pendingRequest))
                // Daily allowance: the resumed request is paid model work like
                // any reply. At the limit, confirm the connection (free), skip
                // the model, send the one daily notice, and ack so the lease
                // does not retry every minute. Fails open on meter errors.
                if ((await isOverDailyAllowance({ chatGuid: guid })).over) {
                    const notice = (await claimLimitNotice(guid)) ? `\n\n${allowanceUsedUpMessage()}` : ''
                    await space.send(toPlainText(`${connectedLine}${notice}`))
                    await ackResume(claimed.id)
                    await saveMessage(guid, 'assistant', `${connectedLine}${notice}`).catch((err) =>
                        console.error('resume message save failed:', err instanceof Error ? err.message : String(err))
                    )
                    results.resumes++
                    continue
                }
                void space.send(typing()).catch(() => {})
                const actions = toolCtx && capabilitiesFor(toolCtx).google ? actionToolsFor(guid) : null
                const tools = toolCtx ? [...toolsFor(toolCtx), ...(actions?.tools ?? [])] : []
                const usage: GatewayUsage[] = []
                const onUsage = (u: GatewayUsage) => usage.push(u)
                let reply: string
                try {
                    reply = toolCtx && tools.length > 0
                        ? (
                              await chatWithTools(
                                  history,
                                  {
                                      gatewayUrl: GATEWAY_URL,
                                      apiKey: SHIPYARD_API_KEY,
                                      model: SHIPYARD_MODEL,
                                      facts,
                                      capabilities: capabilitiesFor(toolCtx),
                                      onUsage,
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
                              onUsage,
                          })
                } finally {
                    // Record whatever was spent, even when the call throws midway.
                    await recordUsage(guid, 'resume', usage).catch((err) =>
                        console.error('resume usage record failed:', err instanceof Error ? err.message : String(err))
                    )
                }
                await space.send(toPlainText(`${connectedLine}\n\n${reply}`))
                const proposal = actions?.proposal()
                if (proposal) await space.send(toPlainText(renderProposal(proposal)))
                void space.send(typing('stop')).catch(() => {})
                await ackResume(claimed.id) // ack ONLY after a successful send
                await saveMessage(guid, 'user', claimed.pendingRequest).catch((err) =>
                    console.error('resume message save failed:', err instanceof Error ? err.message : String(err))
                )
                await saveMessage(guid, 'assistant', reply, Boolean(toolCtx && tools.length > 0)).catch((err) =>
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
