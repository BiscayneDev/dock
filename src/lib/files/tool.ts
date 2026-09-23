/**
 * create_file: Dinghy makes a real document (PDF by default, or Word, a web
 * page, CSV or Markdown) and sends it into the chat as a native attachment.
 *
 * The tool only renders and stores the file; the handler sends it right
 * after the text reply (see spectrum/handler.ts), so the model never has to
 * paste links. Each file is also kept in a private Storage bucket with a
 * signed link, used as the fallback when the attachment send fails.
 *
 * Making a file for the user is not representation: nothing goes to anyone
 * else, so no confirmation step is needed.
 */

import { randomUUID } from 'crypto'
import { createServerClient } from '@/lib/supabase/server'
import type { Tool, ToolResult, UserContext } from '@/lib/llm/types'
import { renderFile, type DinghyDoc, type FileFormat, type RenderedFile } from './render'

export const FILES_BUCKET = 'dinghy-files'
/** Fallback links stay valid for a week. */
export const LINK_TTL_SECONDS = 7 * 24 * 60 * 60
const FORMATS: FileFormat[] = ['pdf', 'docx', 'html', 'csv', 'md']
const MAX_BODY_CHARS = 60_000

export interface MadeFile extends RenderedFile {
    format: FileFormat
    title: string
    subtitle?: string
    /** Signed Storage link, or null when the upload failed. */
    link: string | null
}

export interface FileToolset {
    tools: Tool[]
    /** Files made during this turn, in order. */
    files(): MadeFile[]
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

export function parseFileInput(input: unknown): { doc: DinghyDoc; format: FileFormat } | { error: string } {
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
    return { doc: { title, body, ...(subtitle ? { subtitle } : {}) }, format }
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

export function fileToolsFor(): FileToolset {
    const made: MadeFile[] = []

    const createFile: Tool = {
        name: 'create_file',
        description:
            'Make a polished document and send it to the user as a file in this chat: plans, itineraries, notes, checklists, summaries, tables. ' +
            'Write the body in Markdown (## headings, - lists, | tables |, > callouts). A list item starting with a time like "09:00" becomes a schedule row. ' +
            'Default format is pdf; use docx only when they want to edit it in Word, csv for a plain table, html for a web page, md for raw Markdown. ' +
            'The file is sent right after your reply: say one short line about it, do not paste its contents or a link.',
        inputSchema: {
            type: 'object',
            properties: {
                title: { type: 'string', description: 'Document title, e.g. "Weekend in Key Biscayne"' },
                subtitle: { type: 'string', description: 'Optional one-line subtitle: who, when, where' },
                body: { type: 'string', description: 'The document body in Markdown' },
                format: { type: 'string', enum: FORMATS, description: 'pdf (default), docx, html, csv or md' },
            },
            required: ['title', 'body'],
        },
        async execute(input: unknown, ctx: UserContext): Promise<ToolResult> {
            const parsed = parseFileInput(input)
            if ('error' in parsed) return { success: false, error: parsed.error }
            if (made.length >= 3) return { success: false, error: 'at most 3 files per reply' }
            let file: RenderedFile
            try {
                file = await renderFile(parsed.doc, parsed.format, { ogImage: 'https://www.getdinghy.sh/api/og' })
            } catch (err) {
                return { success: false, error: `could not render the file: ${err instanceof Error ? err.message : String(err)}` }
            }
            let link: string | null = null
            try {
                link = await store(ctx.userId, file)
            } catch (err) {
                console.error('[dinghy] file upload failed', err instanceof Error ? err.message : err)
            }
            made.push({ ...file, format: parsed.format, title: parsed.doc.title, subtitle: parsed.doc.subtitle, link })
            return {
                success: true,
                data: {
                    status: 'will_send_after_reply',
                    filename: file.filename,
                    format: parsed.format,
                    note: 'The file goes out as an attachment right after your reply. Keep the reply to one short line; no link, no contents.',
                },
            }
        },
    }

    return { tools: [createFile], files: () => [...made] }
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
