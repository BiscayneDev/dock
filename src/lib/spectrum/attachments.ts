/**
 * Inbound attachment reading for the iMessage front door.
 *
 * Photos and screenshots go to the model as real image parts (OpenAI
 * `image_url` with a data URI) through the Shipyard gateway, for the turn
 * they arrive only. History keeps a short text description instead, so the
 * image isn't re-billed on every later turn. PDFs and plain-text files are
 * read in-process and become a text stand-in.
 *
 * Voice notes are deliberately not handled here (the user asks Siri-style
 * dictation to cover that for now).
 */

import { extractText } from 'unpdf'
import { readGatewayUsage, type GatewayUsage } from './metering'

export type AttachmentKind = 'image' | 'pdf' | 'text' | 'other'

/** Largest attachment we'll read. Keeps webhook memory, request size and
 *  latency sane. */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024
/** Extract caps: history rows and the model's latency budget. */
export const MAX_EXTRACT_CHARS = 8000
export const MAX_DESCRIBE_CHARS = 1200

/** Image types the model providers accept. HEIC/HEIF (iPhone camera
 *  default) is converted to JPEG first; anything else is refused. */
const MODEL_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp'])
const HEIC = /^image\/hei[cf](-sequence)?$/

/** HEIC → JPEG. Test hook overridable; lazy-loaded so non-photo turns skip the wasm. */
export async function heicToJpeg(buf: Buffer): Promise<Buffer> {
    const { default: convert } = await import('heic-convert')
    const out = await convert({ buffer: buf, format: 'JPEG', quality: 0.85 })
    return Buffer.from(out as ArrayBuffer)
}

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
    | { ok: true; kind: Exclude<AttachmentKind, 'other'>; label: string; standin: string; image?: { dataUrl: string } }
    | { ok: false; label: string; reply: string }

export interface GatewayOpts {
    gatewayUrl: string
    apiKey: string
    model: string
    onUsage?: (u: GatewayUsage) => void
    /** Test hook; defaults to global fetch. */
    fetchFn?: typeof fetch
}

const DESCRIBE_PROMPT =
    'Describe this image for an assistant texting with the person who sent it. ' +
    "If it's a screenshot or document photo, transcribe the important text exactly. " +
    'Under 100 words, plain prose, no preamble.'

/**
 * Short description of an image, through the gateway, for the history row.
 * Runs alongside the reply turn; the image itself is only sent this turn.
 */
export async function describeImage(dataUrl: string, opts: GatewayOpts): Promise<string> {
    const fetchFn = opts.fetchFn ?? fetch
    const t0 = Date.now()
    const res = await fetchFn(`${opts.gatewayUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${opts.apiKey}` },
        body: JSON.stringify({
            model: opts.model,
            max_tokens: 300,
            stream: false,
            messages: [
                {
                    role: 'user',
                    content: [
                        { type: 'text', text: DESCRIBE_PROMPT },
                        { type: 'image_url', image_url: { url: dataUrl } },
                    ],
                },
            ],
        }),
    })
    if (!res.ok) {
        const body = await res.text().catch(() => '')
        throw new Error(`Gateway ${res.status}: ${body.slice(0, 200) || res.statusText}`)
    }
    const data = (await res.json()) as {
        model?: string
        usage?: { prompt_tokens?: number; completion_tokens?: number }
        choices?: { message?: { content?: string | null } }[]
    }
    if (opts.onUsage) {
        try {
            opts.onUsage(readGatewayUsage(res, data, opts.model, Date.now() - t0))
        } catch {
            // metering never breaks a reply
        }
    }
    const text = (data.choices?.[0]?.message?.content ?? '').trim()
    if (!text) throw new Error('gateway returned no description')
    return text.length > MAX_DESCRIBE_CHARS ? text.slice(0, MAX_DESCRIBE_CHARS) + '…' : text
}

/**
 * Turn an inbound attachment into a text stand-in for the normal reply
 * path. Never throws for an expected case: unsupported, oversized or
 * unreadable attachments come back as a user-facing reply line instead.
 */
export async function readInboundAttachment(
    c: InboundAttachmentContent,
    opts: { heicToJpeg?: (buf: Buffer) => Promise<Buffer> } = {}
): Promise<AttachmentRead> {
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
        let mime = (c.mimeType || 'image/jpeg').split(';')[0]!.trim().toLowerCase()
        if (HEIC.test(mime) || /\.hei[cf]$/i.test(name)) {
            try {
                buf = await (opts.heicToJpeg ?? heicToJpeg)(buf)
                mime = 'image/jpeg'
            } catch {
                return { ok: false, label, reply: "couldn't open that photo - try sending it again, or a screenshot of it." }
            }
        }
        if (!MODEL_IMAGE_TYPES.has(mime)) {
            return { ok: false, label, reply: "i can't open that image format - try a screenshot or a jpeg/png." }
        }
        return { ok: true, kind, label, standin: label, image: { dataUrl: `data:${mime};base64,${buf.toString('base64')}` } }
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
