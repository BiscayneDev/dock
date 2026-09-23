/**
 * Sending a Dinghy file into an iMessage thread.
 *
 * The iMessage relay uploads attachments by file name only (no MIME type),
 * and the recipient's Messages app shows a PDF/DOCX from it as a plain file
 * row: no thumbnail, just "tap to open". So each document goes out as two
 * bubbles: first a brand preview card (PNG, which iMessage always renders
 * inline), then the file itself.
 */

import { attachment } from 'spectrum-ts'
import { clip, renderOgCard } from '@/lib/brand/og-card'
import type { FileFormat, RenderedFile } from './render'

interface Sender {
    send(content: unknown): Promise<unknown>
}

const KIND: Record<FileFormat, string> = { pdf: 'pdf', docx: 'word doc', html: 'web page', csv: 'csv', md: 'markdown' }

/** Page count of a pdfkit PDF (counts page objects, not the page tree). */
export function pdfPageCount(bytes: Buffer): number {
    return (bytes.toString('latin1').match(/\/Type\s*\/Page(?![a-zA-Z])/g) ?? []).length
}

export function previewLabel(format: FileFormat, bytes: Buffer): string {
    if (format !== 'pdf') return KIND[format]
    const n = pdfPageCount(bytes)
    return n > 0 ? `pdf · ${n} ${n === 1 ? 'page' : 'pages'}` : 'pdf'
}

/** The preview card for a file: coast art, cream panel, title, subtitle. */
export async function renderFilePreview(file: RenderedFile & { format: FileFormat; title: string; subtitle?: string }): Promise<Buffer> {
    const res = renderOgCard({
        label: previewLabel(file.format, file.bytes),
        title: clip(file.title.toLowerCase(), 80),
        sub: file.subtitle ? clip(file.subtitle, 110) : undefined,
        foot: 'made by dinghy',
    })
    return Buffer.from(await res.arrayBuffer())
}

/**
 * Preview card, then the file. The card is best-effort: if it fails to
 * render or send, the file still goes out. Throws only when the file send
 * itself fails, so callers can fall back to a link.
 */
export async function sendFileWithPreview(
    space: Sender,
    file: RenderedFile & { format: FileFormat; title: string; subtitle?: string }
): Promise<{ preview: boolean }> {
    let preview = false
    if (file.format === 'pdf' || file.format === 'docx') {
        try {
            const png = await renderFilePreview(file)
            await space.send(attachment(png, { name: file.filename.replace(/\.[a-z]+$/, '') + '-preview.png', mimeType: 'image/png' }))
            preview = true
        } catch (err) {
            console.error('[dinghy] file preview failed', err instanceof Error ? err.message : err)
        }
    }
    await space.send(attachment(file.bytes, { name: file.filename, mimeType: file.mimeType }))
    return { preview }
}
