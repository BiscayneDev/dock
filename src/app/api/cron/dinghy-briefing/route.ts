/**
 * Dinghy morning briefing (cron, hourly at 8am in each user timezone): one iMessage per bound Spectrum
 * identity — today's calendar, unread/important email, and (owner only)
 * Dinghy waitlist signups. Delivered through the tool loop so the text is
 * grounded in live Gmail/Calendar reads, in Dinghy's voice.
 *
 * Delivery goes through the Spectrum outbox (enqueue, then the sweep sends
 * and retries) — a direct space.send alone dies unretried if the function
 * is killed mid-tail. Opt-in state lives in briefing_settings (migration
 * 033): default-on for Google-connected users, muted via the digest
 * footer's "mute mornings" reply (handled in the webhook path). Quiet
 * hours via time-utils.
 *
 * Format: the model returns the brief as JSON and it goes out as a designed
 * card (brief-card.tsx) with weather for where the person is (fresh shared
 * pin, else briefing_settings.home_place). If the reply isn't usable JSON,
 * or the card can't render, the plain text goes out instead.
 *
 * Audience rule: every bound identity gets THEIR OWN briefing (bindings
 * are fail-closed on the beta allowlist). Product-admin data (waitlist)
 * goes only to the chat whose Gmail profile is on the owner domain.
 */

import { NextRequest, NextResponse } from 'next/server'
import { google } from 'googleapis'
import { createServerClient } from '@/lib/supabase/server'
import { getAuthedClient } from '@/lib/integrations/google'
import { getSpectrumApp, getImessage } from '@/lib/spectrum/app'
import { IMESSAGE_READ_TOOLS, loadImessageToolContext } from '@/lib/spectrum/imessage-tools'
import { isBriefingEnabled, briefingForceKey, clearBriefingForce, MUTE_FOOTER } from '@/lib/spectrum/briefing'
import { briefRequestKey, claimBrief, enqueueBriefAtomic, releaseBrief } from '@/lib/spectrum/brief-claim'
import { markOutboxSent } from '@/lib/spectrum/outbox'
import { isOverDailyAllowance } from '@/lib/allowance'
import { recordUsage, type GatewayUsage } from '@/lib/spectrum/metering'
import { chatWithTools } from '@/lib/spectrum/dinghy'
import { GATEWAY_URL, SHIPYARD_API_KEY, SHIPYARD_MODEL } from '@/lib/spectrum/config'
import { loadFacts, saveMessage } from '@/spectrum/store'
import { isInQuietHours, getCurrentHour } from '@/lib/time-utils'
import { BRIEF_JSON_SPEC, cardDate, cardTime, parseBriefReply, sendBrief } from '@/lib/spectrum/brief-card-send'
import { briefLocation } from '@/lib/spectrum/location'
import { cardWeather } from '@/lib/weather/brief-weather'
import { toPlainText } from '@/lib/spectrum/plain-text'
import { decideBrief, lastTextByChat, LIVE_CONVERSATION_MS } from '@/lib/spectrum/proactive-gate'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

const OWNER_DOMAIN = '@biscayneventures.xyz'

// The hourly cron fires at minute 0; the morning window (8-9am local) lives in proactive-gate.ts.

export async function GET(request: NextRequest): Promise<NextResponse> {
    if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (!SHIPYARD_API_KEY) {
        return NextResponse.json({ skipped: true, reason: 'SHIPYARD_API_KEY not set' })
    }

    const supabase = createServerClient()
    const app = await getSpectrumApp()
    const im = await getImessage(app)
    const facts = await loadFacts().catch(() => [])

    const { data: identities } = await supabase
        .from('spectrum_identities')
        .select('chat_guid, user_id')
        .not('user_id', 'is', null)

    // Waitlist total once per run; shared only with the owner below.
    let waitlistCount: number | null = null
    try {
        const { count } = await supabase.from('waitlist').select('*', { count: 'exact', head: true })
        waitlistCount = count
    } catch {
        waitlistCount = null
    }

    const results = { briefings: 0, skipped: 0, errors: 0, deferred: 0 }

    // Quiet by default, step 1: decide who is due from cheap rows (timezone,
    // quiet hours, a text in the last few minutes) BEFORE decrypting any
    // token or touching Google. Two batched reads cover every user.
    const userIds = [...new Set((identities ?? []).map((r) => r.user_id as string))]
    const { data: userRows } = userIds.length
        ? await supabase.from('users').select('id, timezone, quiet_hours_start, quiet_hours_end').in('id', userIds)
        : { data: [] as { id: string; timezone: string | null; quiet_hours_start: string | null; quiet_hours_end: string | null }[] }
    const usersById = new Map((userRows ?? []).map((u) => [u.id as string, u]))
    const recentSince = new Date(Date.now() - LIVE_CONVERSATION_MS).toISOString()
    const { data: recentTexts } = await supabase
        .from('spectrum_messages')
        .select('chat_guid, created_at')
        .eq('role', 'user')
        .gte('created_at', recentSince)
        .limit(1000)
    const lastText = lastTextByChat((recentTexts ?? []) as { chat_guid: string; created_at: string }[])

    for (const row of identities ?? []) {
        const chatGuid = row.chat_guid as string
        {
            const u = usersById.get(row.user_id as string)
            const tz = u?.timezone && u.timezone !== 'UTC' ? u.timezone : 'America/New_York'
            const forced = (await briefingForceKey(row.user_id as string).catch(() => null)) !== null
            const lastAt = lastText.get(chatGuid)
            const decision = decideBrief({
                localHour: getCurrentHour(tz),
                forced,
                inQuietHours: isInQuietHours(u?.quiet_hours_start ?? null, u?.quiet_hours_end ?? null, tz),
                sinceLastUserTextMs: lastAt ? Date.now() - lastAt : null,
            })
            if (decision.act === 'skip') { results.skipped++; continue }
            if (decision.act === 'wait') { results.deferred++; continue }
        }
        // Set once this run owns the day's generation; cleared when the brief is queued.
        let held: { userId: string; localDay: string; key: string } | null = null
        try {
            const ctx = await loadImessageToolContext(chatGuid)
            // Briefing is Google-driven; a PayBox-only binding has nothing to brief.
            if (!ctx || !ctx.tokens.google) {
                results.skipped++
                continue
            }

            // Opt-in: a briefing_settings row wins; no row means default-on.
            if (!(await isBriefingEnabled(ctx.userId))) {
                results.skipped++
                continue
            }

            // Daily allowance: briefings are paid work too. At the limit
            // the briefing skips silently until the midnight reset.
            if ((await isOverDailyAllowance({ chatGuid, userId: ctx.userId, tz: ctx.timezone })).over) {
                results.skipped++
                continue
            }

            // One-off "brief me now" skips the window and quiet hours.
            const forceStamp = await briefingForceKey(ctx.userId)
            const forced = forceStamp !== null

            // Quiet hours + morning window in the user's timezone.
            const { data: user } = await supabase
                .from('users')
                .select('quiet_hours_start, quiet_hours_end')
                .eq('id', ctx.userId)
                .maybeSingle()
            const timezone = ctx.timezone
            if (
                !forced &&
                isInQuietHours(
                    (user?.quiet_hours_start as string | null) ?? null,
                    (user?.quiet_hours_end as string | null) ?? null,
                    timezone
                )
            ) {
                results.skipped++
                continue
            }

            // Claim the day BEFORE any paid work (Gmail profile, weather, model).
            // Overlapping or replayed cron runs lose here instead of paying for
            // a second generation. "Brief me now" has its own key.
            const claimNow = new Date()
            const localDay = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(claimNow)
            const requestKey = briefRequestKey(forceStamp)
            const claim = await claimBrief(ctx.userId, localDay, requestKey)
            if (!claim.ok) {
                if (claim.reason === 'error') {
                    console.error(`briefing claim failed (${chatGuid}):`, claim.error)
                    results.errors++
                } else {
                    results.skipped++
                }
                continue
            }
            held = { userId: ctx.userId, localDay, key: requestKey }

            // Owner check via the Gmail profile on the bound account —
            // product-admin numbers never leave for anyone else.
            let isOwner = false
            try {
                const auth = await getAuthedClient(ctx.tokens.google!, ctx.userId)
                const gmail = google.gmail({ version: 'v1', auth })
                const profile = await gmail.users.getProfile({ userId: 'me' })
                isOwner = (profile.data.emailAddress ?? '').endsWith(OWNER_DOMAIN)
            } catch {
                isOwner = false
            }

            const today = new Date().toLocaleDateString('en-US', {
                weekday: 'long',
                month: 'long',
                day: 'numeric',
                timeZone: timezone,
            })
            // Weather where they are: fresh shared pin, else home place.
            const loc = await briefLocation(ctx.userId).catch(() => null)
            const weather = loc ? await cardWeather(loc.lat, loc.lon, loc.label) : null

            const ask =
                `Morning briefing for ${today}. Use your tools: today's calendar, ` +
                'unread email (count + the couple that actually look important)' +
                (isOwner && waitlistCount !== null
                    ? `, and this product note: the Dinghy waitlist is at ${waitlistCount} signups`
                    : '') +
                (weather
                    ? `. Weather is already on the card (${weather.temp}°F, ${weather.sky} in ${weather.place}, high ${weather.high}, ` +
                      `${weather.rain ?? 0}% rain), so don't repeat numbers; the opener can nod to the sky`
                    : '') +
                '. ' +
                BRIEF_JSON_SPEC

            const usage: GatewayUsage[] = []
            const { reply } = await chatWithTools(
                [{ role: 'user', content: ask }],
                {
                    gatewayUrl: GATEWAY_URL,
                    apiKey: SHIPYARD_API_KEY,
                    model: SHIPYARD_MODEL,
                    facts,
                    // The briefing is Google data by definition: private route from the first call.
                    startTainted: true,
                    onUsage: (u: GatewayUsage) => usage.push(u),
                },
                IMESSAGE_READ_TOOLS,
                ctx
            )
            // Briefings count toward the daily allowance like any other work.
            await recordUsage(chatGuid, 'briefing', usage).catch(() => {})
            const now = new Date()
            const brief = parseBriefReply(reply, { date: cardDate(now, timezone), time: cardTime(now, timezone), weather })
            // Not card-shaped: fall back to the old plain-text briefing.
            const plain = brief ? brief.text : reply.trim().startsWith('{') ? '' : reply
            if (!brief && !plain) {
                console.error(`briefing reply unusable (${chatGuid})`)
                results.errors++
                continue
            }
            const text = `${plain}\n\n${MUTE_FOOTER}`
            // Queue + mark the day done in one transaction. Before this call the
            // claim is a releasable lease; after it the key is 'sent', so no
            // later run can reclaim it. The outbox row (leased) is retried by
            // the spectrum-sweep cron if the direct send below fails or the
            // process dies.
            const queued = brief
                ? await enqueueBriefAtomic(held.userId, held.localDay, held.key, chatGuid, 'brief', JSON.stringify({ card: brief.card, text }))
                : await enqueueBriefAtomic(held.userId, held.localDay, held.key, chatGuid, 'reply', text)
            if (!queued.ok) {
                if (queued.reason === 'already_sent') {
                    // A stale run lost the race to a reclaiming run that already queued it.
                    held = null
                    results.skipped++
                } else {
                    console.error(`briefing outbox enqueue failed (${chatGuid}):`, queued.error)
                    results.errors++ // lease released in finally; a retry can claim
                }
                continue
            }
            held = null
            const outboxId = queued.outboxId
            if (forced) await clearBriefingForce(ctx.userId).catch(() => {})
            // Best-effort immediate send; the sweep covers any failure.
            try {
                const space = await im.space.get(chatGuid)
                if (brief) await sendBrief(space, { card: brief.card, text })
                else await space.send(toPlainText(text))
                await markOutboxSent(outboxId)
            } catch (sendErr) {
                console.error(
                    `briefing direct send failed, sweep will retry (${chatGuid}):`,
                    sendErr instanceof Error ? sendErr.message : String(sendErr)
                )
            }
            await saveMessage(chatGuid, 'assistant', text, true).catch(() => {})
            results.briefings++
        } catch (err) {
            console.error(`briefing failed (${chatGuid}):`, err instanceof Error ? err.message : String(err))
            results.errors++
        } finally {
            // Any exit before the brief was queued frees the lease for a retry.
            if (held) await releaseBrief(held.userId, held.localDay, held.key).catch(() => {})
        }
    }

    return NextResponse.json(results)
}
