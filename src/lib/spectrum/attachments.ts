/**
 * Inbound attachment reading for the iMessage front door.
 *
 * Photos, screenshots, PDFs and plain-text files a user texts Dinghy become
 * a text stand-in that flows through the normal reply path, so the model can
 * discuss what was sent. The Shipyard gateway is text-only (its ChatMessage
 * content is a string), so images are described by Gemini; PDFs and text
 * files are read in-process.
 *
 * Voice notes are deliberately not handled here (the user asks Siri-style
 * dictation to cover that for now).
 */

import { extractText } from 'unpdf'
import { GEMINI_API_KEY, GEMINI_MODEL } from './config'

export type AttachmentKind = 'image' | 'pdf' | 'text' | 'other'

/** Largest attachment we'll read. Gemini's inline ceiling is 20 MB; the cap
 *  keeps webhook memory and latency sane. */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024
/** Extract caps: history rows and the model's latency budget. */
export const MAX_EXTRACT_CHARS = 8000
export const MAX_DESCRIBE_CHARS = 1200

/** Extensions treated as readable text even when the MIME type is generic. */
const TEXT_EXT = /\.(txt|md|markdown|csv|tsv|json|log|xml|ya?ml|html?|css|js|ts|tsx|py|rb|go|rs|java|c|h|cpp|sh|sql|ini|cfg)$/i

export function classifyAttachment(name: string, mimeType: string): AttachmentKind {
    const mime = (mimeType || '').split(';')[0]!.trim().toLowerCase()
    if (mime.startsWith('image/')) return 'image'
    if (mime === 'application/pdf' || /\.pdf$/i.test(name)) return 'pdf'
    if (mime.startsWith('text/') || mime === 'application/json' || mime === 'application/xml' || TEXT_EXT.test(name)) return 'text'
    return 'other'
}

/** The attachment content shape Spectrum delivers inbound (webhook mode). */
export interface InboundAttachmentContent {
    name?: string
    mimeType?: string
    size?: number
    read?: () => Promise<Buffer>
}

export type AttachmentRead =
    | { ok: true; kind: Exclude<AttachmentKind, 'other'>; label: string; standin: string }
    | { ok: false; label: string; reply: string }

export interface AttachmentReadOpts {
    /** Defaults to GEMINI_API_KEY. */
    geminiKey?: string
    /** Defaults to GEMINI_MODEL. */
    geminiModel?: string
    /** Test hook; defaults to global fetch. */
    fetchFn?: typeof fetch
}

const DESCRIBE_PROMPT =
    'Describe this image for an assistant texting with the person who sent it. ' +
    "If it's a screenshot or document photo, transcribe the important text exactly. " +
    'Under 100 words, plain prose, no preamble.'

/** Describe an image with Gemini (flash-class, ~1-2k tokens per photo). */
export async function describeImage(buf: Buffer, mimeType: string, opts: AttachmentReadOpts = {}): Promise<string> {
    const key = opts.geminiKey ?? GEMINI_API_KEY
    if (!key) throw new Error('GEMINI_API_KEY is not set')
    const model = opts.geminiModel ?? GEMINI_MODEL
    const fetchFn = opts.fetchFn ?? fetch
    const mime = (mimeType || 'image/jpeg').split(';')[0]!.trim().toLowerCase()
    const res = await fetchFn(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents: [{ parts: [{ text: DESCRIBE_PROMPT }, { inline_data: { mime_type: mime, data: buf.toString('base64') } }] }],
            generationConfig: { maxOutputTokens: 400 },
        }),
    })
    if (!res.ok) {
        const body = await res.text().catch(() => '')
        throw new Error(`Gemini ${res.status}: ${body.slice(0, 200) || res.statusText}`)
    }
    const data = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] }
    const text = (data.candidates?.[0]?.content?.parts ?? [])
        .map((p) => p.text ?? '')
        .join(' ')
        .trim()
    if (!text) throw new Error('Gemini returned no description')
    return text.length > MAX_DESCRIBE_CHARS ? text.slice(0, MAX_DESCRIBE_CHARS) + '…' : text
}

/**
 * Turn an inbound attachment into a text stand-in for the normal reply
 * path. Never throws for an expected case: unsupported, oversized or
 * unreadable attachments come back as a user-facing reply line instead.
 */
export async function readInboundAttachment(c: InboundAttachmentContent, opts: AttachmentReadOpts = {}): Promise<AttachmentRead> {
    const name = (c.name ?? '').trim()
    const kind = classifyAttachment(name, c.mimeType ?? '')
    const label = kind === 'image' ? '[sent a photo]' : kind === 'pdf' ? `[sent a pdf${name ? `: ${name}` : ''}]` : `[sent a file${name ? `: ${name}` : ''}]`

    if (kind === 'other') {
        return { ok: false, label: '[sent an attachment]', reply: "i can't open that kind of file yet - photos, screenshots, pdfs and text files work." }
    }
    if ((c.size ?? 0) > MAX_ATTACHMENT_BYTES) {
        return { ok: false, label, reply: "that file's too big for me to read - over 10 mb." }
    }
    if (!c.read) {
        return { ok: false, label, reply: "couldn't download that attachment - try sending it again in a moment." }
    }
    let buf: Buffer
    try {
        buf = await c.read()
    } catch {
        return { ok: false, label, reply: "couldn't download that attachment - try sending it again in a moment." }
    }
    if (buf.length > MAX_ATTACHMENT_BYTES) {
        return { ok: false, label, reply: "that file's too big for me to read - over 10 mb." }
    }

    if (kind === 'image') {
        if (!(opts.geminiKey ?? GEMINI_API_KEY)) {
            return { ok: false, label, reply: "i can't look at photos yet - that part's still being wired up on my end." }
        }
        const desc = await describeImage(buf, c.mimeType ?? '', opts)
        return { ok: true, kind, label, standin: `${label} ${desc}` }
    }

    if (kind === 'pdf') {
        let text = ''
        try {
            const out = await extractText(new Uint8Array(buf), { mergePages: true })
            text = (Array.isArray(out.text) ? out.text.join('\n') : String(out.text ?? '')).trim()
        } catch {
            text = ''
        }
        if (text.length < 20) {
            return { ok: false, label, reply: "couldn't pull text out of that pdf - it might be a scan. photos of the pages work." }
        }
        const clipped = text.length > MAX_EXTRACT_CHARS ? text.slice(0, MAX_EXTRACT_CHARS) + '\n[truncated]' : text
        return { ok: true, kind, label, standin: `${label}\n${clipped}` }
    }

    // text-ish file
    const text = buf.toString('utf8').trim()
    if (!text) {
        return { ok: false, label, reply: "that file looks empty - nothing for me to read." }
    }
    const clipped = text.length > MAX_EXTRACT_CHARS ? text.slice(0, MAX_EXTRACT_CHARS) + '\n[truncated]' : text
    return { ok: true, kind, label, standin: `${label}\n${clipped}` }
}
