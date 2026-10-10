/**
 * create_file: Dinghy makes a real document and hands it to the user.
 *
 * Default delivery is a hosted page on here.now that opens with no code: an
 * unguessable, unindexed link that expires in 7 days, with the PDF
 * downloadable from the page. The link is the share mechanism: the user can
 * forward it to anyone. revoke_file deletes a file so its link stops working.
 * Native attachments are for when the user wants the file itself
 * (attach=true, or docx/csv/md), and the fallback when hosting fails.
 *
 * The tool only renders and publishes; the handler sends right after the
 * text reply (see spectrum/handler.ts). Each PDF/attachment is also kept in
 * a private Storage bucket with a signed link as the last-resort fallback.
 *
 * Making a file for the user is not representation: nothing goes to anyone
 * else, so no confirmation step is needed. Forwarding the link is the user's call.
 */

import { dinghyLineFor } from '@/lib/spectrum/line-for-chat'
import { randomUUID } from 'crypto'
import { createServerClient } from '@/lib/supabase/server'
import type { Tool, ToolResult, UserContext } from '@/lib/llm/types'
import { renderFile, renderHtml, type DinghyDoc, type FileFormat, type RenderedFile } from './render'
import { attachPhotos, type Photo } from './photos'
import { publishSite, revokeSite, shareEnabled, type PublishedSite, type SiteFile } from './share'
import { findFile, rememberFile } from '@/lib/spectrum/plans'
import { geocodeCached, nearbyEateries, keywords, toPlaces, zoneAt, anchorConfident, looksLikeStreetAddress, geocoderIsPrivate, BudgetUnavailable } from '@/lib/places/osm'
import { freshPin, roundCoord } from '@/lib/places/pin'
import { buildPlacesDoc } from '@/lib/places/page'

export const FILES_BUCKET = 'dinghy-files'
/** Fallback links stay valid for a week. */
export const LINK_TTL_SECONDS = 7 * 24 * 60 * 60
const FORMATS: FileFormat[] = ['pdf', 'docx', 'html', 'csv', 'md']
/** Formats that can be a hosted page; the rest are always attachments. */
const HOSTABLE: FileFormat[] = ['pdf', 'html']
const MAX_BODY_CHARS = 60_000

export type HostedFile = PublishedSite

export interface MadeFile extends RenderedFile {
    format: FileFormat
    title: string
    kind?: 'file' | 'itinerary'
    subtitle?: string
    /** Signed Storage link, or null when the upload failed. */
    link: string | null
    /** Set when the file went out as a here.now page instead of an attachment. */
    hosted?: HostedFile
    /** The document body, kept so Dinghy can reopen and update its own files. */
    markdown?: string
}

/** Save the file to memory (dinghy_files). Best-effort: never blocks the reply. */
async function remember(ctx: UserContext, f: MadeFile): Promise<void> {
    if (!ctx.userId) return
    await rememberFile(ctx.userId, null, {
        title: f.title,
        kind: f.kind,
        format: f.hosted ? 'page' : f.format,
        url: f.hosted?.url ?? f.link,
        markdown: f.markdown ?? '',
        expires_at: f.hosted?.expiresAt ?? (f.link ? new Date(Date.now() + LINK_TTL_SECONDS * 1000).toISOString() : null),
    }).catch((err) => console.error('[dinghy] file memory failed', err instanceof Error ? err.message : err))
}

export interface FileToolset {
    tools: Tool[]
    /** Files made during this turn, in order. */
    files(): MadeFile[]
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

export function parseFileInput(input: unknown): { doc: DinghyDoc; format: FileFormat; attach: boolean } | { error: string } {
    const i = (input ?? {}) as Record<string, unknown>
    const title = str(i.title)
    const body = typeof i.body === 'string' ? i.body : ''
    if (!title || !body.trim()) return { error: 'title and body are required' }
    if (title.length > 140) return { error: 'title is too long (max 140 characters)' }
    if (body.length > MAX_BODY_CHARS) return { error: `body is too long (max ${MAX_BODY_CHARS} characters)` }
    const raw = str(i.format).toLowerCase() || 'pdf'
    const format = (raw === 'word' ? 'docx' : raw === 'markdown' ? 'md' : raw) as FileFormat
    if (!FORMATS.includes(format)) return { error: `format must be one of ${FORMATS.join(', ')}` }
    const subtitle = str(i.subtitle)
    return { doc: { title, body, ...(subtitle ? { subtitle } : {}) }, format, attach: i.attach === true }
}

/** Per-file link card: what iMessage shows when the link unfurls. */
export function fileCardUrl(doc: DinghyDoc, kind: string): string {
    const q = new URLSearchParams({ title: doc.title, kind })
    if (doc.subtitle) q.set('sub', doc.subtitle)
    return `https://www.getdinghy.sh/api/og/file?${q.toString()}`
}

/** "oct 24" in the user's zone; used in the thread copy. */
export function shortDate(iso: string, timeZone = 'America/New_York'): string {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return ''
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone }).toLowerCase()
}

async function store(userId: string, file: RenderedFile): Promise<string | null> {
    const supabase = createServerClient()
    const path = `${userId}/${randomUUID()}/${file.filename}`
    const up = await supabase.storage.from(FILES_BUCKET).upload(path, file.bytes, { contentType: file.mimeType, upsert: false })
    if (up.error) throw up.error
    const signed = await supabase.storage.from(FILES_BUCKET).createSignedUrl(path, LINK_TTL_SECONDS, { download: file.filename })
    if (signed.error) throw signed.error
    return signed.data?.signedUrl ?? null
}

/** Dinghy's line for this chat, so reply buttons can open Messages to it. Never blocks the page. */
async function replyLineFor(chatGuid: string | undefined): Promise<string | undefined> {
    if (!chatGuid) return undefined
    try { return await dinghyLineFor(chatGuid) } catch { return undefined }
}

async function host(input: DinghyDoc, format: FileFormat, userId: string, replyLine?: string, photosOk = false): Promise<{ hosted: HostedFile; pdf: RenderedFile | null }> {
    // Free credited photos, only on a clean turn, never longer than 12s in total. A miss keeps the colour card.
    const found = await Promise.race([
        attachPhotos(input.body, { allowed: photosOk }),
        new Promise<{ body: string; photos: [] }>((resolve) => setTimeout(() => resolve({ body: input.body, photos: [] }), 12_000)),
    ]).catch(() => ({ body: input.body, photos: [] as Photo[] }))
    const doc: DinghyDoc = { ...input, body: found.body }
    const pdf = format === 'pdf' ? await renderFile(doc, 'pdf') : null
    const html = renderHtml(doc, {
        ogImage: fileCardUrl(doc, format === 'pdf' ? 'pdf' : 'page'),
        ...(replyLine ? { replyLine } : {}),
        ...(pdf ? { download: { href: pdf.filename, label: 'download pdf' } } : {}),
    })
    const files: SiteFile[] = [{ path: 'index.html', bytes: Buffer.from(html, 'utf8'), contentType: 'text/html; charset=utf-8' }]
    if (pdf) files.push({ path: pdf.filename, bytes: pdf.bytes, contentType: pdf.mimeType })
    for (const p of found.photos) files.push({ path: p.path, bytes: p.bytes, contentType: p.contentType })
    const hosted = await publishSite(files, { title: doc.title, userId })
    return { hosted, pdf }
}

export function fileToolsFor(): FileToolset {
    const made: MadeFile[] = []

    const createFile: Tool = {
        name: 'create_file',
        description:
            'Make a polished document for the user: plans, itineraries, schedules, notes, checklists, summaries, tables. ' +
            'Write the body in Markdown (## headings, - lists, | tables |, > callouts). A list item starting with a time like "09:00" becomes a schedule row. ' +
            'By default it becomes a file link (a here.now page with a pdf download on it) that opens with one tap, no code; the link is sent right after your reply. ' +
            'Set attach=true only when they want the file itself in the chat (a pdf to print or forward as a file). docx (to edit in Word), csv and md always arrive as attachments. ' +
            'The link is private unless they forward it: anyone they send it to can open it too. It expires after 7 days; asking again later makes a fresh link. ' +
            'Say one short line about it; do not paste its contents or the link.',
        inputSchema: {
            type: 'object',
            properties: {
                title: { type: 'string', description: 'Document title, e.g. "Weekend in Key Biscayne"' },
                kind: { type: 'string', enum: ['file', 'itinerary'], description: 'Use itinerary only for an actual trip itinerary. Otherwise file.' },
                subtitle: { type: 'string', description: 'Optional one-line subtitle: who, when, where' },
                body: { type: 'string', description: 'The document body in Markdown' },
                format: { type: 'string', enum: FORMATS, description: 'pdf (default), docx, html, csv or md' },
                attach: { type: 'boolean', description: 'Send the file itself as an attachment instead of a private file link. Only when asked for the file.' },
            },
            required: ['title', 'body'],
        },
        async execute(input: unknown, ctx: UserContext): Promise<ToolResult> {
            const parsed = parseFileInput(input)
            if ('error' in parsed) return { success: false, error: parsed.error }
            if (made.length >= 3) return { success: false, error: 'at most 3 files per reply' }
            const kind = (input as Record<string, unknown>).kind === 'itinerary' ? 'itinerary' : 'file'
            const wantsPage = !parsed.attach && HOSTABLE.includes(parsed.format)
            let hostError: string | undefined
            if (wantsPage && shareEnabled()) {
                try {
                    const { hosted, pdf } = await host(parsed.doc, parsed.format, ctx.userId, await replyLineFor(ctx.chatGuid), ctx.photosOk === true)
                    const file = pdf ?? (await renderFile(parsed.doc, 'html'))
                    const entry: MadeFile = { ...file, format: parsed.format, kind, title: parsed.doc.title, subtitle: parsed.doc.subtitle, link: null, hosted, markdown: parsed.doc.body }
                    made.push(entry)
                    await remember(ctx, entry)
                    return {
                        success: true,
                        data: {
                            status: 'queued_for_delivery',
                            delivery: 'file_link',
                            expires: shortDate(hosted.expiresAt),
                            note: 'The app sends the new link immediately after your assistant message, without waiting for the user. Never reuse a link from history. Give a short verdict, not a delivery promise or link.',
                        },
                    }
                } catch (err) {
                    console.error('[dinghy] hosted file publish failed', err instanceof Error ? err.message : err)
                    hostError = 'could not make the file link, sending the file instead'
                }
            }
            const format: FileFormat = wantsPage && parsed.format === 'html' ? 'pdf' : parsed.format
            let file: RenderedFile
            try {
                file = await renderFile(parsed.doc, format, { ogImage: 'https://www.getdinghy.sh/api/og' })
            } catch (err) {
                return { success: false, error: `could not render the file: ${err instanceof Error ? err.message : String(err)}` }
            }
            let link: string | null = null
            try {
                link = await store(ctx.userId, file)
            } catch (err) {
                console.error('[dinghy] file upload failed', err instanceof Error ? err.message : err)
            }
            const entry: MadeFile = { ...file, format, kind, title: parsed.doc.title, subtitle: parsed.doc.subtitle, link, markdown: parsed.doc.body }
            made.push(entry)
            await remember(ctx, entry)
            return {
                success: true,
                data: {
                    status: 'queued_for_delivery',
                    delivery: 'attachment',
                    filename: file.filename,
                    format,
                    ...(hostError ? { page_error: hostError } : {}),
                    note: hostError
                        ? 'The file link did not work this time; the file goes out as an attachment instead. Say so in one short line.'
                        : 'The app sends the attachment immediately after your assistant message, without waiting for the user. Give a short verdict, not a delivery promise or link.',
                },
            }
        },
    }

    const findPlaces: Tool = {
        name: 'find_places',
        description:
            'Find real food and drink places near an address, hotel or landmark, with open-now, walking time, address, hours and map links, from OpenStreetMap (free, no key). ' +
            'Use this FIRST for "where should I eat / get X near Y" asks; do not use web_search for nearby venues. ' +
            'It makes the options page itself and the link goes out right after your reply, so do not call create_file for it. ' +
            'Give anchor as a searchable place with the city ("Parkroyal on Pickering, Singapore") and what as the food ("chicken rice"). The local time zone is worked out from the map position. ' +
            'Open or closed is only reported when the listed hours can be read; otherwise it says hours not listed. Never add hours, ratings or prices the tool did not return. ' +
            'Never pass a street address as anchor (they are not sent to public map servers): use a landmark, hotel or neighbourhood name, or ask for one. Reply with your pick in one or two lines using only what it returned.',
        inputSchema: {
            type: 'object',
            properties: {
                anchor: { type: 'string', description: 'Where to search around: hotel, address or landmark, with the city' },
                what: { type: 'string', description: 'The food or kind of place, e.g. "chicken rice", "ramen", "coffee"' },
                radius_m: { type: 'number', description: 'Search radius in metres, default 1500, max 3000' },
            },
            required: ['anchor', 'what'],
        },
        async execute(input: unknown, ctx: UserContext): Promise<ToolResult> {
            const i = (input ?? {}) as Record<string, unknown>
            const anchor = str(i.anchor).slice(0, 200), what = str(i.what).slice(0, 80)
            if (!anchor || !what) return { success: false, error: 'anchor and what are required' }
            const radius = Math.min(3000, Math.max(300, Math.round(typeof i.radius_m === 'number' ? i.radius_m : 1500)))
            try {
                // A street address (likely home or work) is never sent to a public geocoder. Use the
                // user's shared pin if they have one; otherwise ask for a landmark or hotel name.
                let origin: { lat: number; lon: number; label: string } | null
                let fromPin = false
                if (looksLikeStreetAddress(anchor) && !geocoderIsPrivate()) {
                    const pin = ctx.userId ? await freshPin(ctx.userId) : null
                    if (!pin) return { success: false, error: 'that looks like a street address, which I do not send to a public map server. Ask them for a landmark, hotel or neighbourhood name instead, or to share a location pin in this chat.' }
                    // Rounded to ~100 m: the exact spot is not needed to find nearby food and never goes to a public server.
                    origin = { lat: roundCoord(pin.lat), lon: roundCoord(pin.lon), label: pin.label ?? 'your shared pin' }
                    fromPin = true
                } else {
                    origin = await geocodeCached(anchor)
                }
                if (!origin) return { success: false, error: `could not find "${anchor}" on the map; ask for a street address or a nearby landmark` }
                // Open-now uses the timezone AT the place, derived from its coordinates. Never the user's home zone or UTC.
                const tz = zoneAt(origin.lat, origin.lon)
                const confident = fromPin || anchorConfident(anchor, origin.label)
                const now = new Date()
                const words = keywords(what)
                const all = toPlaces(await nearbyEateries(origin, radius), origin, words, now, tz ?? 'UTC', tz === null)
                const matched = all.filter((p) => p.matched)
                const strong = matched.filter((p) => !p.chain)
                const places = (strong.length ? strong : matched.length ? matched : all).slice(0, 6)
                if (!places.length) return { success: false, error: 'no named food places found in the map data around there' }
                const unmatchedNote = matched.length ? undefined : `Nothing in the map data is tagged "${what}" within ${radius} m, so these are the nearest eateries instead. Check the menu before you go.`
                const doc = buildPlacesDoc({ places, what: matched.length ? what : 'food', anchor, tz: tz ?? 'UTC', now, unmatchedNote, resolved: origin.label, lowConfidence: !confident })
                const made_ = await createFile.execute({ title: doc.title, subtitle: doc.subtitle, body: doc.body, format: 'html', kind: 'file' }, ctx)
                return {
                    success: true,
                    data: {
                        page: made_.success ? 'will_send_after_reply' : `not made: ${made_.success ? '' : made_.error}`,
                        matched: matched.length > 0,
                        searched_around: origin.label,
                        ...(confident ? {} : { low_confidence: 'The map match for the anchor is weak. Say in your reply which place was searched (searched_around) and ask them to confirm or give a street address.' }),
                        ...(doc.allUnknown ? { note_hours: 'No listed hours for any of these: say once, up front, that open-now is unknown and to call ahead.' } : {}),
                        ...(unmatchedNote ? { note: unmatchedNote } : {}),
                        places: places.map((p) => ({ name: p.name, status: p.status.text, state: p.status.state, walk_min: p.walkMin, distance_m: p.distanceM, address: p.address || undefined, hours: p.hours, cuisine: p.cuisine })),
                        text_fallback: doc.text,
                        instruction: 'Reply with your pick and one reason in one or two lines using only these fields. If the page was not made, give this short list in chat and say the page did not go out. Do not call create_file for this.',
                    },
                }
            } catch (err) {
                if (err instanceof BudgetUnavailable) return { success: false, error: "I couldn't look that up right now (the free map service is busy). Say so in one line and give a short answer from one web search instead; do not retry find_places this turn." }
                console.error('[dinghy] find_places failed', err instanceof Error ? err.message : err)
                return { success: false, error: 'the map lookup did not respond; say so and suggest one web search instead' }
            }
        },
    }

    const recallFile: Tool = {
        name: 'recall_file',
        description:
            'Open a file you made for this person earlier (in any chat): returns its title, link and full Markdown body. ' +
            'Use it before updating an earlier file (then call create_file with the complete updated body) or when they ask what was in it.',
        inputSchema: {
            type: 'object',
            properties: { query: { type: 'string', description: 'Words from the file title, e.g. "spain itinerary", or its link' } },
            required: ['query'],
        },
        async execute(input: unknown, ctx: UserContext): Promise<ToolResult> {
            const query = str(((input ?? {}) as Record<string, unknown>).query)
            if (!query) return { success: false, error: 'query is required' }
            if (!ctx.userId) return { success: false, error: 'no saved files for this chat' }
            try {
                const f = await findFile(ctx.userId, query)
                if (!f) return { success: false, error: 'no saved file matches that' }
                return { success: true, data: { title: f.title, format: f.format, url: f.url, made: f.created_at, body: f.markdown } }
            } catch {
                return { success: false, error: 'could not open saved files just now' }
            }
        },
    }

    const revokeFile: Tool = {
        name: 'revoke_file',
        description:
            'Delete a file link you made earlier (its here.now link is in the chat history) so it stops working for everyone, ' +
            'e.g. when the user says they sent it to the wrong person or wants it gone. To give them a fresh link, make the file again with create_file.',
        inputSchema: {
            type: 'object',
            properties: { link: { type: 'string', description: 'The file link, e.g. https://calm-boat-1a2b.here.now/' } },
            required: ['link'],
        },
        async execute(input: unknown, ctx: UserContext): Promise<ToolResult> {
            const link = str(((input ?? {}) as Record<string, unknown>).link)
            if (!link) return { success: false, error: 'link is required' }
            try {
                const r = await revokeSite(link, ctx.userId)
                const { error } = await createServerClient().from('dinghy_files')
                    .update({ revoked_at: new Date().toISOString() })
                    .eq('user_id', ctx.userId).eq('url', r.url)
                if (error) return { success: false, error: 'The hosted link is revoked, but the library state could not be updated. Try again to sync it.' }
                return { success: true, data: { status: 'revoked', url: r.url, note: 'That link no longer opens for anyone.' } }
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err)
                return { success: false, error: /not one of your|not a Dinghy/.test(msg) ? msg : 'could not delete that file just now' }
            }
        },
    }

    return { tools: shareEnabled() ? [createFile, findPlaces, recallFile, revokeFile] : [createFile, findPlaces, recallFile], files: () => [...made] }
}

/** Remove "[sent file: x]" markers the model may copy into its reply text. */
export function stripFileMarkers(text: string): { text: string; hadMarker: boolean } {
    const re = /\[\s*(?:sent )?file:[^\]]*\]/gi
    const hadMarker = re.test(text)
    return { text: text.replace(re, '').replace(/\n{3,}/g, '\n\n').trim(), hadMarker }
}

/** One-shot nudge when the model claimed a file without calling create_file. */
export const FILE_NUDGE =
    'Note from the Dinghy app: your last reply claimed a new or updated document, but no file was created this turn. An older link from history is not this document. ' +
    'Call create_file now with the complete, updated document, then reply with one short line. Never write "[sent file: ...]" yourself.'
