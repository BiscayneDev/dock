/**
 * Dinghy morning briefing (cron, 8am ET): one iMessage per bound Spectrum
 * identity — today's calendar, unread/important email, and (owner only)
 * Dinghy waitlist signups. Delivered through the tool loop so the text is
 * grounded in live Gmail/Calendar reads, in Dinghy's voice.
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
import { chatWithTools } from '@/lib/spectrum/dinghy'
import { GATEWAY_URL, SHIPYARD_API_KEY, SHIPYARD_MODEL } from '@/lib/spectrum/config'
import { loadFacts, saveMessage } from '@/spectrum/store'
import { typing } from 'spectrum-ts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

const OWNER_DOMAIN = '@biscayneventures.xyz'

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
            if (!ctx) {
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
                timeZone: ctx.timezone,
            })
            const ask =
                `Morning briefing for ${today}. Use your tools: today's calendar, ` +
                'unread email (count + the couple that actually look important)' +
                (isOwner && waitlistCount !== null
                    ? `, and this product note: the Dinghy waitlist is at ${waitlistCount} signups`
                    : '') +
                '. One short text, your voice, no headers, no bullet spam.'

            const space = await im.space.get(chatGuid)
            void space.send(typing()).catch(() => {})
            const { reply } = await chatWithTools(
                [{ role: 'user', content: ask }],
                { gatewayUrl: GATEWAY_URL, apiKey: SHIPYARD_API_KEY, model: SHIPYARD_MODEL, facts },
                IMESSAGE_READ_TOOLS,
                ctx
            )
            await space.send(reply)
            void space.send(typing('stop')).catch(() => {})
            await saveMessage(chatGuid, 'assistant', reply).catch(() => {})
            results.briefings++
        } catch (err) {
            console.error(`briefing failed (${chatGuid}):`, err instanceof Error ? err.message : String(err))
            results.errors++
        }
    }

    return NextResponse.json(results)
}
