import { describe, it, expect, vi } from 'vitest'
import PDFDocument from 'pdfkit'

import {
    classifyAttachment,
    describeImage,
    readInboundAttachment,
    MAX_ATTACHMENT_BYTES,
} from '@/lib/spectrum/attachments'

/** Minimal one-page PDF via pdfkit (already a dependency). */
async function makePdf(text: string): Promise<Buffer> {
    const doc = new PDFDocument()
    const chunks: Buffer[] = []
    doc.on('data', (c: Buffer) => chunks.push(c))
    const done = new Promise<void>((resolve) => doc.on('end', resolve))
    if (text) doc.text(text)
    doc.end()
    await done
    return Buffer.concat(chunks)
}

const geminiOk = (text: string) => async () =>
    new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), { status: 200 })

describe('classifyAttachment', () => {
    it('sorts by mime type, then extension', () => {
        expect(classifyAttachment('IMG_1234.jpeg', 'image/jpeg')).toBe('image')
        expect(classifyAttachment('photo.HEIC', 'image/heic')).toBe('image')
        expect(classifyAttachment('doc.pdf', 'application/pdf')).toBe('pdf')
        expect(classifyAttachment('doc.PDF', 'application/octet-stream')).toBe('pdf')
        expect(classifyAttachment('data.csv', 'text/csv')).toBe('text')
        expect(classifyAttachment('notes.md', 'application/octet-stream')).toBe('text')
        expect(classifyAttachment('config.json', 'application/json')).toBe('text')
        expect(classifyAttachment('archive.zip', 'application/zip')).toBe('other')
        expect(classifyAttachment('voice.caf', 'audio/x-caf')).toBe('other')
    })
})

describe('readInboundAttachment', () => {
    it('describes an image and builds the stand-in', async () => {
        const read = await readInboundAttachment(
            { name: 'IMG_1.png', mimeType: 'image/png', read: async () => Buffer.from('png-bytes') },
            { geminiKey: 'k', fetchFn: geminiOk('a boarding pass for flight UA 123, seat 4A') as typeof fetch }
        )
        expect(read).toEqual({
            ok: true,
            kind: 'image',
            label: '[sent a photo]',
            standin: '[sent a photo] a boarding pass for flight UA 123, seat 4A',
        })
    })

    it('passes the image to gemini as inline base64', async () => {
        let body = ''
        const fetchFn = async (_u: unknown, init?: RequestInit) => {
            body = String(init?.body ?? '')
            return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] }), { status: 200 })
        }
        await describeImage(Buffer.from('hi'), 'image/webp', { geminiKey: 'k', fetchFn: fetchFn as typeof fetch })
        expect(body).toContain('"mime_type":"image/webp"')
        expect(body).toContain(`"data":"${Buffer.from('hi').toString('base64')}"`)
    })

    it('says photos are not wired when the gemini key is missing', async () => {
        const read = await readInboundAttachment(
            { name: 'x.png', mimeType: 'image/png', read: async () => Buffer.from('x') },
            { geminiKey: '' }
        )
        expect(read.ok).toBe(false)
        if (!read.ok) expect(read.reply).toMatch(/can't look at photos yet/)
    })

    it('extracts pdf text into the stand-in', async () => {
        const bytes = await makePdf('dinghy provisioning checklist: fuel, lines, fenders')
        const read = await readInboundAttachment(
            { name: 'checklist.pdf', mimeType: 'application/pdf', read: async () => Buffer.from(bytes) },
            { geminiKey: '' }
        )
        expect(read.ok).toBe(true)
        if (read.ok) {
            expect(read.label).toBe('[sent a pdf: checklist.pdf]')
            expect(read.standin).toContain('provisioning checklist')
        }
    })

    it('reads text files and clips long ones', async () => {
        const long = 'row,'.repeat(4000)
        const read = await readInboundAttachment(
            { name: 'data.csv', mimeType: 'text/csv', read: async () => Buffer.from(long) },
            { geminiKey: '' }
        )
        expect(read.ok).toBe(true)
        if (read.ok) {
            expect(read.standin.startsWith('[sent a file: data.csv]\n')).toBe(true)
            expect(read.standin).toContain('[truncated]')
            expect(read.standin.length).toBeLessThan(8500)
        }
    })

    it('rejects oversized, unsupported and empty attachments with a reply line', async () => {
        const big = await readInboundAttachment(
            { name: 'big.png', mimeType: 'image/png', size: MAX_ATTACHMENT_BYTES + 1, read: async () => Buffer.from('x') },
            { geminiKey: 'k' }
        )
        expect(big).toMatchObject({ ok: false, reply: expect.stringMatching(/too big/) })

        const zip = await readInboundAttachment(
            { name: 'a.zip', mimeType: 'application/zip', read: async () => Buffer.from('PK') },
            { geminiKey: 'k' }
        )
        expect(zip).toMatchObject({ ok: false, reply: expect.stringMatching(/can't open that kind of file/) })

        const empty = await readInboundAttachment(
            { name: 'n.txt', mimeType: 'text/plain', read: async () => Buffer.from('  ') },
            { geminiKey: 'k' }
        )
        expect(empty).toMatchObject({ ok: false, reply: expect.stringMatching(/looks empty/) })
    })

    it('flags scanned pdfs (no extractable text)', async () => {
        const bytes = await makePdf('')
        const read = await readInboundAttachment(
            { name: 'scan.pdf', mimeType: 'application/pdf', read: async () => Buffer.from(bytes) },
            { geminiKey: '' }
        )
        expect(read).toMatchObject({ ok: false, reply: expect.stringMatching(/might be a scan/) })
    })
})

describe('describeImage failures', () => {
    it('throws on a gemini error so the handler can send the generic line', async () => {
        const fetchFn = vi.fn(async () => new Response('nope', { status: 429 }))
        await expect(describeImage(Buffer.from('x'), 'image/png', { geminiKey: 'k', fetchFn: fetchFn as unknown as typeof fetch })).rejects.toThrow(/Gemini 429/)
    })
})
