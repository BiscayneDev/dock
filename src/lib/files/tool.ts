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

import { randomUUID } from 'crypto'
import { createServerClient } from '@/lib/supabase/server'
import type { Tool, ToolResult, UserContext } from '@/lib/llm/types'
import { renderFile, renderHtml, type DinghyDoc, type FileFormat, type RenderedFile } from './render'
import { publishSite, revokeSite, shareEnabled, type PublishedSite, type SiteFile } from './share'
import { findFile, rememberFile } from '@/lib/spectrum/plans'

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

async function host(doc: DinghyDoc, format: FileFormat, userId: string): Promise<{ hosted: HostedFile; pdf: RenderedFile | null }> {
    const pdf = format === 'pdf' ? await renderFile(doc, 'pdf') : null
    const html = renderHtml(doc, {
        ogImage: fileCardUrl(doc, format === 'pdf' ? 'pdf' : 'page'),
        ...(pdf ? { download: { href: pdf.filename, label: 'download pdf' } } : {}),
    })
    const files: SiteFile[] = [{ path: 'index.html', bytes: Buffer.from(html, 'utf8'), contentType: 'text/html; charset=utf-8' }]
    if (pdf) files.push({ path: pdf.filename, bytes: pdf.bytes, contentType: pdf.mimeType })
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
            const wantsPage = !parsed.attach && HOSTABLE.includes(parsed.format)
            let hostError: string | undefined
            if (wantsPage && shareEnabled()) {
                try {
                    const { hosted, pdf } = await host(parsed.doc, parsed.format, ctx.userId)
                    const file = pdf ?? (await renderFile(parsed.doc, 'html'))
                    const entry: MadeFile = { ...file, format: parsed.format, title: parsed.doc.title, subtitle: parsed.doc.subtitle, link: null, hosted, markdown: parsed.doc.body }
                    made.push(entry)
                    await remember(ctx, entry)
                    return {
                        success: true,
                        data: {
                            status: 'will_send_after_reply',
                            delivery: 'file_link',
                            expires: shortDate(hosted.expiresAt),
                            note: 'The file link goes out right after your reply. One short line; no link, no contents.',
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
            const entry: MadeFile = { ...file, format, title: parsed.doc.title, subtitle: parsed.doc.subtitle, link, markdown: parsed.doc.body }
            made.push(entry)
            await remember(ctx, entry)
            return {
                success: true,
                data: {
                    status: 'will_send_after_reply',
                    delivery: 'attachment',
                    filename: file.filename,
                    format,
                    ...(hostError ? { page_error: hostError } : {}),
                    note: hostError
                        ? 'The file link did not work this time; the file goes out as an attachment instead. Say so in one short line.'
                        : 'The file goes out as an attachment right after your reply. Keep the reply to one short line; no link, no contents.',
                },
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
                return { success: true, data: { status: 'revoked', url: r.url, note: 'That link no longer opens for anyone.' } }
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err)
                return { success: false, error: /not one of your|not a Dinghy/.test(msg) ? msg : 'could not delete that file just now' }
            }
        },
    }

    return { tools: shareEnabled() ? [createFile, recallFile, revokeFile] : [createFile, recallFile], files: () => [...made] }
}

/** Remove "[sent file: x]" markers the model may copy into its reply text. */
export function stripFileMarkers(text: string): { text: string; hadMarker: boolean } {
    const re = /\[\s*(?:sent )?file:[^\]]*\]/gi
    const hadMarker = re.test(text)
    return { text: text.replace(re, '').replace(/\n{3,}/g, '\n\n').trim(), hadMarker }
}

/** One-shot nudge when the model claimed a file without calling create_file. */
export const FILE_NUDGE =
    'Note from the Dinghy app: your last reply said a file was sent or updated, but you did not call create_file, so nothing was attached. ' +
    'Call create_file now with the complete, updated document, then reply with one short line. Never write "[sent file: ...]" yourself.'
