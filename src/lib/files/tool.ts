/**
 * create_file: Dinghy makes a real document and hands it to the user.
 *
 * Default delivery is a hosted page on here.now: private (a visitor code the
 * user gets in the thread) and expiring, with the PDF downloadable from the
 * page. Native attachments are for when the user wants the file itself
 * (attach=true, or docx/csv/md), and the fallback when hosting fails.
 * share_file turns sharing on (anyone with the link) or back off per file.
 *
 * The tool only renders and publishes; the handler sends right after the
 * text reply (see spectrum/handler.ts). Each PDF/attachment is also kept in
 * a private Storage bucket with a signed link as the last-resort fallback.
 *
 * Making a file for the user is not representation: nothing goes to anyone
 * else, so no confirmation step is needed. Sharing is the user's call.
 */

import { randomUUID } from 'crypto'
import { createServerClient } from '@/lib/supabase/server'
import type { Tool, ToolResult, UserContext } from '@/lib/llm/types'
import { renderFile, renderHtml, type DinghyDoc, type FileFormat, type RenderedFile } from './render'
import { publishSite, setSharing, shareEnabled, type PublishedSite, type SiteFile } from './share'

export const FILES_BUCKET = 'dinghy-files'
/** Fallback links stay valid for a week. */
export const LINK_TTL_SECONDS = 7 * 24 * 60 * 60
const FORMATS: FileFormat[] = ['pdf', 'docx', 'html', 'csv', 'md']
/** Formats that can be a hosted page; the rest are always attachments. */
const HOSTABLE: FileFormat[] = ['pdf', 'html']
const MAX_BODY_CHARS = 60_000

export interface HostedFile extends PublishedSite {
    /** True when anyone with the link can open it (no code). */
    shared: boolean
}

export interface MadeFile extends RenderedFile {
    format: FileFormat
    title: string
    subtitle?: string
    /** Signed Storage link, or null when the upload failed. */
    link: string | null
    /** Set when the file went out as a here.now page instead of an attachment. */
    hosted?: HostedFile
}

export interface FileToolset {
    tools: Tool[]
    /** Files made during this turn, in order. */
    files(): MadeFile[]
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

export function parseFileInput(input: unknown): { doc: DinghyDoc; format: FileFormat; share: boolean; attach: boolean } | { error: string } {
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
    return { doc: { title, body, ...(subtitle ? { subtitle } : {}) }, format, share: i.share === true, attach: i.attach === true }
}

/** Per-file link card for shared pages (the private gate hides it anyway). */
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

async function host(doc: DinghyDoc, format: FileFormat, userId: string, shared: boolean): Promise<{ hosted: HostedFile; pdf: RenderedFile | null }> {
    const pdf = format === 'pdf' ? await renderFile(doc, 'pdf') : null
    const html = renderHtml(doc, {
        ogImage: fileCardUrl(doc, format === 'pdf' ? 'pdf' : 'page'),
        ...(pdf ? { download: { href: pdf.filename, label: 'download pdf' } } : {}),
    })
    const files: SiteFile[] = [{ path: 'index.html', bytes: Buffer.from(html, 'utf8'), contentType: 'text/html; charset=utf-8' }]
    if (pdf) files.push({ path: pdf.filename, bytes: pdf.bytes, contentType: pdf.mimeType })
    const site = await publishSite(files, { title: doc.title, userId, shared })
    return { hosted: { ...site, shared }, pdf }
}

export function fileToolsFor(): FileToolset {
    const made: MadeFile[] = []

    const createFile: Tool = {
        name: 'create_file',
        description:
            'Make a polished document for the user: plans, itineraries, schedules, notes, checklists, summaries, tables. ' +
            'Write the body in Markdown (## headings, - lists, | tables |, > callouts). A list item starting with a time like "09:00" becomes a schedule row. ' +
            'By default it becomes a private file link (a here.now page with a pdf download on it) that only the user can open with a code; the link and code are sent right after your reply. ' +
            'Set attach=true only when they want the file itself in the chat (a pdf to print or forward as a file). docx (to edit in Word), csv and md always arrive as attachments. ' +
            'Set share=true only when they say they want to send it to other people: then anyone with the link can open it, no code. ' +
            'Everything expires after 30 days. Say one short line about it; do not paste its contents, the link or the code.',
        inputSchema: {
            type: 'object',
            properties: {
                title: { type: 'string', description: 'Document title, e.g. "Weekend in Key Biscayne"' },
                subtitle: { type: 'string', description: 'Optional one-line subtitle: who, when, where' },
                body: { type: 'string', description: 'The document body in Markdown' },
                format: { type: 'string', enum: FORMATS, description: 'pdf (default), docx, html, csv or md' },
                attach: { type: 'boolean', description: 'Send the file itself as an attachment instead of a private file link. Only when asked for the file.' },
                share: { type: 'boolean', description: 'Make the file open to anyone with the link. Only when the user wants to share it.' },
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
                    const { hosted, pdf } = await host(parsed.doc, parsed.format, ctx.userId, parsed.share)
                    const file = pdf ?? (await renderFile(parsed.doc, 'html'))
                    made.push({ ...file, format: parsed.format, title: parsed.doc.title, subtitle: parsed.doc.subtitle, link: null, hosted })
                    return {
                        success: true,
                        data: {
                            status: 'will_send_after_reply',
                            delivery: hosted.shared ? 'shared_file' : 'private_file',
                            expires: shortDate(hosted.expiresAt),
                            note: hosted.shared
                                ? 'A file link anyone can open goes out right after your reply. One short line; no link, no contents.'
                                : 'A private file link goes out right after your reply, with the code to open it. One short line; no link, no code, no contents.',
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
            made.push({ ...file, format, title: parsed.doc.title, subtitle: parsed.doc.subtitle, link })
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

    const shareFile: Tool = {
        name: 'share_file',
        description:
            'Turn sharing on or off for a file you made earlier (its here.now link is in the chat history). ' +
            'share=true: anyone with the link can open it, no code - only when the user asks to share or send it to someone. ' +
            'share=false: private again with a new code. Include the link in your reply when sharing; include the new code when making it private.',
        inputSchema: {
            type: 'object',
            properties: {
                link: { type: 'string', description: 'The page link, e.g. https://calm-boat-1a2b.here.now/' },
                share: { type: 'boolean', description: 'true to share, false to make it private again' },
            },
            required: ['link', 'share'],
        },
        async execute(input: unknown, ctx: UserContext): Promise<ToolResult> {
            const i = (input ?? {}) as Record<string, unknown>
            const link = str(i.link)
            if (!link || typeof i.share !== 'boolean') return { success: false, error: 'link and share are required' }
            try {
                const site = await setSharing(link, ctx.userId, i.share)
                return {
                    success: true,
                    data: i.share
                        ? { status: 'shared', url: site.url, note: 'Anyone with this link can open it now, until it expires.' }
                        : { status: 'private', url: site.url, code: site.password, note: 'Private again; the old code no longer works. Give the user the new code.' },
                }
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err)
                return { success: false, error: /not one of your|not a Dinghy/.test(msg) ? msg : 'could not change sharing just now' }
            }
        },
    }

    return { tools: shareEnabled() ? [createFile, shareFile] : [createFile], files: () => [...made] }
}

/** Remove "[sent file: x]" markers the model may copy into its reply text. */
export function stripFileMarkers(text: string): { text: string; hadMarker: boolean } {
    const re = /\[\s*sent file:[^\]]*\]/gi
    const hadMarker = re.test(text)
    return { text: text.replace(re, '').replace(/\n{3,}/g, '\n\n').trim(), hadMarker }
}

/** One-shot nudge when the model claimed a file without calling create_file. */
export const FILE_NUDGE =
    'Note from the Dinghy app: your last reply said a file was sent or updated, but you did not call create_file, so nothing was attached. ' +
    'Call create_file now with the complete, updated document, then reply with one short line. Never write "[sent file: ...]" yourself.'
