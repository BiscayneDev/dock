/**
 * Dinghy morning briefing (cron, 8am ET): one iMessage per bound Spectrum
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
import { isBriefingEnabled, isBriefingForced, clearBriefingForce, MUTE_FOOTER } from '@/lib/spectrum/briefing'
import { enqueueOutbox, markOutboxSent } from '@/lib/spectrum/outbox'
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

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

const OWNER_DOMAIN = '@biscayneventures.xyz'

// Send inside a morning window (7-10am local); the cron itself fires at 8.
const BRIEFING_WINDOW_START = 7
const BRIEFING_WINDOW_END = 10

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

    const results = { briefings: 0, skipped: 0, errors: 0 }

    for (const row of identities ?? []) {
        const chatGuid = row.chat_guid as string
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
            const forced = await isBriefingForced(ctx.userId)

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
            const hour = getCurrentHour(timezone)
            if (!forced && (hour < BRIEFING_WINDOW_START || hour >= BRIEFING_WINDOW_END)) {
                results.skipped++
                continue
            }

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
            // Outbox first: the row exists before the attempt, so a kill or
            // a send failure is always retried by the spectrum-sweep cron.
            const outboxId = brief
                ? await enqueueOutbox(chatGuid, 'brief', JSON.stringify({ card: brief.card, text }))
                : await enqueueOutbox(chatGuid, 'reply', text)
            if (!outboxId) {
                console.error(`briefing outbox enqueue failed (${chatGuid})`)
                results.errors++
                continue
            }
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
            await saveMessage(chatGuid, 'assistant', text).catch(() => {})
            results.briefings++
        } catch (err) {
            console.error(`briefing failed (${chatGuid}):`, err instanceof Error ? err.message : String(err))
            results.errors++
        }
    }

    return NextResponse.json(results)
}
