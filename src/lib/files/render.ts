/**
 * Dinghy file renderer. One document model (title + markdown body) rendered in
 * the Dinghy paper look (see src/lib/brand): cream paper, midnight ink, coral
 * accent, Fraunces headlines, Schibsted Grotesk body, DM Mono labels, and the
 * sunrise-over-water scene at the top.
 *   - HTML  share page, fonts embedded, sunrise band, OG tags for the link card
 *   - PDF   same system, fonts embedded, sunrise strip drawn natively (pdfkit)
 *   - DOCX  same type system by name (not embedded: embedded fonts break
 *           LibreOffice/Pages rendering), mapped to Word styles (docx)
 * Plus CSV passthrough for tables. Everything is pure JS: no headless browser.
 */

import PDFDocument from 'pdfkit'
import { marked, type Token, type Tokens } from 'marked'
import {
    AlignmentType,
    BorderStyle,
    Document,
    Packer,
    Paragraph,
    Table,
    TableCell,
    TableRow,
    TextRun,
    WidthType,
} from 'docx'
import { dmMono500, frauncesDisplay, frauncesItalic, schibsted400, schibsted600 } from '@/lib/brand/static-fonts'
import { paper } from '@/lib/brand/tokens'
import { anchorSvg, sunriseSvg } from '@/lib/brand/scene'

export type FileFormat = 'pdf' | 'docx' | 'html' | 'csv' | 'md'

export interface DinghyDoc {
    title: string
    subtitle?: string
    /** Markdown body: headings, paragraphs, lists, tables, quotes, rules. */
    body: string
}

export interface RenderedFile {
    filename: string
    mimeType: string
    bytes: Buffer
}

export const BRAND = {
    paper: paper.cream,
    sand: paper.sand,
    ink: paper.midnight,
    body: paper.bodySolid,
    mute: paper.mutedSolid,
    line: paper.lineSolid,
    accent: paper.coral,
}

const MIME: Record<FileFormat, string> = {
    pdf: 'application/pdf',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    html: 'text/html; charset=utf-8',
    csv: 'text/csv; charset=utf-8',
    md: 'text/markdown; charset=utf-8',
}

/** "Weekend in Key Biscayne!" -> "weekend-in-key-biscayne" */
export function slugify(title: string): string {
    return (
        title
            .toLowerCase()
            .normalize('NFKD')
            .replace(/[^\w\s-]/g, '')
            .trim()
            .replace(/[\s_]+/g, '-')
            .replace(/-+/g, '-')
            .slice(0, 60) || 'dinghy-file'
    )
}

// A list item like "09:00 Coffee", "9am - Coffee", "Sat 10:00 | Brunch" renders as a time row.
const TIME_ROW = /^\s*((?:(?:mon|tue|wed|thu|fri|sat|sun)\w*\.?\s+)?\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s*(?:[-–—|:]\s*)?(.+)$/i

export function splitTimeRow(text: string): { time: string; rest: string } | null {
    const m = text.match(TIME_ROW)
    if (!m) return null
    if (!/[:]|am|pm/i.test(m[1])) return null // "3 eggs" is not a time
    return { time: m[1].trim(), rest: m[2].trim() }
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Inline markdown (bold/italic/code/links) to plain text for PDF/DOCX runs. */
function plain(text: string): string {
    return text
        .replace(/\*\*(.+?)\*\*/g, '$1')
        .replace(/__(.+?)__/g, '$1')
        .replace(/(^|\W)\*(.+?)\*(?=\W|$)/g, '$1$2')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
}

interface Run {
    text: string
    bold?: boolean
}
/** Split inline text into bold/regular runs. */
function runs(text: string): Run[] {
    const out: Run[] = []
    const re = /\*\*(.+?)\*\*/g
    let last = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(text))) {
        if (m.index > last) out.push({ text: plain(text.slice(last, m.index)) })
        out.push({ text: plain(m[1]), bold: true })
        last = m.index + m[0].length
    }
    if (last < text.length) out.push({ text: plain(text.slice(last)) })
    return out.filter((r) => r.text)
}

function tokens(md: string): Token[] {
    return marked.lexer(md ?? '')
}

// ── HTML ─────────────────────────────────────────────────────────────────────

export interface HtmlOptions {
    ogImage?: string
    description?: string
}

export function renderHtml(doc: DinghyDoc, opts: HtmlOptions = {}): string {
    const body: string[] = []
    for (const t of tokens(doc.body)) {
        if (t.type === 'heading') {
            const h = t as Tokens.Heading
            body.push(h.depth <= 2 ? `<section class="sec"><h2>${marked.parseInline(h.text)}</h2></section>` : `<h3>${marked.parseInline(h.text)}</h3>`)
        } else if (t.type === 'list') {
            const l = t as Tokens.List
            const items = l.items.map((it) => {
                const tr = splitTimeRow(it.text)
                return tr
                    ? `<div class="row"><span class="t">${esc(tr.time)}</span><span>${marked.parseInline(tr.rest)}</span></div>`
                    : `<li>${marked.parseInline(it.text)}</li>`
            })
            const allRows = items.every((i) => i.startsWith('<div'))
            body.push(allRows ? `<div class="rows">${items.join('')}</div>` : `<${l.ordered ? 'ol' : 'ul'}>${items.join('')}</${l.ordered ? 'ol' : 'ul'}>`)
        } else if (t.type === 'hr') body.push('<hr>')
        else if (t.type === 'space') continue
        else body.push(marked.parser([t]))
    }
    const desc = opts.description ?? doc.subtitle ?? 'Made by Dinghy.'
    const og = opts.ogImage
        ? `<meta property="og:image" content="${esc(opts.ogImage)}"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta name="twitter:card" content="summary_large_image">`
        : ''
    const face = (family: string, b64: string, weight: number, style = 'normal') =>
        `@font-face{font-family:'${family}';src:url(data:font/woff;base64,${b64}) format('woff');font-weight:${weight};font-style:${style};font-display:swap}`
    return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(doc.title)} · Dinghy</title>
<meta name="description" content="${esc(desc)}">
<meta property="og:title" content="${esc(doc.title)}"><meta property="og:description" content="${esc(desc)}">
<meta property="og:site_name" content="Dinghy"><meta property="og:type" content="article">${og}
<meta name="robots" content="noindex"><meta name="theme-color" content="${BRAND.paper}">
<style>
${face('Fraunces', frauncesDisplay, 500)}${face('Fraunces', frauncesItalic, 400, 'italic')}${face('Schibsted', schibsted400, 400)}${face('Schibsted', schibsted600, 600)}${face('DM Mono', dmMono500, 500)}
:root{--paper:${BRAND.paper};--sand:${BRAND.sand};--ink:${BRAND.ink};--body:rgba(14,26,51,.78);--mute:rgba(14,26,51,.55);--line:rgba(14,26,51,.12);--accent:${BRAND.accent}}
*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--body);font:17px/1.6 Schibsted,-apple-system,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased}
.band{position:relative;height:340px;overflow:hidden}.band svg{position:absolute;inset:0;width:100%;height:100%;display:block}
.card{position:relative;max-width:720px;width:calc(100% - 24px);margin:-72px auto 0;background:var(--paper);border-radius:24px;padding:44px 48px 40px;box-shadow:0 24px 60px rgba(14,26,51,.12)}
.brand{display:flex;align-items:center;gap:10px;font:500 11px/1 'DM Mono',ui-monospace,monospace;letter-spacing:.16em;text-transform:uppercase;color:var(--accent)}
h1{font:500 48px/1.03 Fraunces,Georgia,serif;letter-spacing:-.02em;color:var(--ink);margin:18px 0 10px}
.sub{margin:0 0 8px;font-size:18px;color:var(--body)}
.sec{border-top:1px solid var(--line);margin-top:36px;padding-top:28px}
h2{font:500 28px/1.15 Fraunces,Georgia,serif;letter-spacing:-.015em;color:var(--ink);margin:0 0 6px}
h3{font:600 17px/1.35 Schibsted,sans-serif;margin:24px 0 6px;color:var(--ink)}
p{margin:10px 0}a{color:var(--accent);text-underline-offset:3px}strong{font-weight:600;color:var(--ink)}em{font-family:Fraunces,Georgia,serif;font-style:italic;font-size:1.06em}
ul,ol{padding-left:22px}li{margin:6px 0}li::marker{color:var(--accent)}
.rows{margin:6px 0}.row{display:grid;grid-template-columns:104px 1fr;gap:12px;padding:9px 0;border-bottom:1px solid var(--line)}.row:last-child{border-bottom:0}
.t{font:500 13px/1.75 'DM Mono',monospace;color:var(--accent)}
table{width:100%;border-collapse:collapse;margin:16px 0;font-size:15px}
th{font:500 11px 'DM Mono',monospace;letter-spacing:.12em;text-transform:uppercase;color:var(--ink);text-align:left;padding:10px 12px;background:var(--sand)}
th:first-child{border-radius:8px 0 0 8px}th:last-child{border-radius:0 8px 8px 0}
td{padding:10px 12px;border-bottom:1px solid var(--line)}
blockquote{margin:20px 0;padding:14px 18px;border-radius:16px;background:var(--sand);color:var(--ink);font:italic 400 19px/1.45 Fraunces,Georgia,serif}blockquote p{margin:0}
code{font:14px 'DM Mono',monospace;background:var(--sand);padding:1px 6px;border-radius:6px}
hr{border:0;border-top:1px solid var(--line);margin:32px 0}
.foot{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;max-width:720px;margin:0 auto;padding:36px 24px 44px;font:500 10px 'DM Mono',monospace;letter-spacing:.16em;text-transform:uppercase;color:var(--mute)}.foot a{color:inherit;text-decoration:none}
@media (max-width:600px){.band{height:220px}.card{margin-top:-52px;padding:28px 22px 26px}h1{font-size:36px}h2{font-size:24px}body{font-size:16px}.row{grid-template-columns:84px 1fr}}
</style></head>
<body>
<div class="band" aria-hidden="true">${sunriseSvg({ id: 'f', sunX: 900, boatX: 300, horizon: 330 })}</div>
<main class="card">
<div class="brand">${anchorSvg(BRAND.ink, 18)}<span>dinghy</span></div>
<h1>${esc(doc.title)}</h1>
${doc.subtitle ? `<p class="sub">${esc(doc.subtitle)}</p>` : ''}
${body.join('\n')}
</main>
<div class="foot"><span>made by dinghy</span><a href="https://www.getdinghy.sh">getdinghy.sh</a></div>
</body></html>`
}

// ── PDF ──────────────────────────────────────────────────────────────────────

// Sunrise strip for page one, drawn with pdfkit primitives from the same scene
// geometry as src/lib/brand/scene.ts (viewBox 1200x630, horizon 300 here).
type Pdf = InstanceType<typeof PDFDocument>
function drawSunriseStrip(pdf: Pdf, width: number, height: number): void {
    const s = width / 1200
    const top = 60 // viewBox y shown at the top of the strip
    const H = 300 // horizon
    const sunX = 900
    pdf.save()
    pdf.rect(0, 0, width, height).clip()
    pdf.translate(0, -top * s).scale(s)
    const sky = pdf.linearGradient(0, 0, 0, H)
    sky.stop(0, '#2F3F73').stop(0.42, '#7F93C9').stop(0.72, '#E7B5B0').stop(0.9, '#F7C196').stop(1, '#F79E75')
    pdf.rect(0, 0, 1200, H + 1).fill(sky)
    const glow = pdf.radialGradient(sunX, H, 0, sunX, H, 360)
    glow.stop(0, '#FFE6B8', 0.95).stop(0.35, '#FFD2A0', 0.45).stop(1, '#FFD2A0', 0)
    pdf.rect(0, 0, 1200, H).fill(glow)
    pdf.save().rect(0, 0, 1200, H).clip().circle(sunX, H + 6, 64).fill('#FFE2AA').restore()
    pdf.save().roundedRect(140, H - 73, 280, 6, 3).fillOpacity(0.5).fill('#FBDCCB').restore()
    pdf.save().roundedRect(sunX + 90, H - 121, 160, 7, 3.5).fillOpacity(0.55).fill('#FFE9D6').restore()
    const cloud = (x: number, y: number, k: number, o: number) => {
        pdf.save().translate(x, y).scale(k).fillOpacity(o)
        pdf.path('M-120 30 C-122 8 -100 -4 -82 2 C-76 -26 -40 -38 -18 -18 C-8 -48 40 -52 56 -20 C80 -32 112 -14 106 14 C126 16 132 30 124 36 L-112 36 C-122 36 -124 32 -120 30 Z').fill('#FFF6EC')
        pdf.fillOpacity(o * 0.7).path('M-116 36 L124 36 C118 30 106 26 96 28 C84 22 66 26 58 30 C40 24 12 26 0 30 C-20 24 -52 26 -66 30 C-84 24 -104 28 -116 36 Z').fill('#F4C9B6')
        pdf.restore()
    }
    cloud(220, 150, 1.25, 0.92)
    cloud(sunX + 120, 96, 0.9, 0.88)
    cloud(620, 230, 0.62, 0.8)
    const sea = pdf.linearGradient(0, H, 0, 630)
    sea.stop(0, '#E59A86').stop(0.25, '#A493B4').stop(0.6, '#5B72A8').stop(1, '#2A3A68')
    pdf.rect(0, H, 1200, 630 - H).fill(sea)
    for (let i = 0; i < 7; i++) {
        const w = 150 - i * 18
        pdf.save().roundedRect(sunX - w / 2, H + 10 + i * 17, w, 4, 2).fillOpacity(0.85 - i * 0.1).fill('#FFE2AA').restore()
    }
    for (const [x, y, w] of [[80, 350, 180], [420, 385, 120], [620, 350, 90], [1040, 420, 120]]) {
        pdf.save().roundedRect(x, y, w, 2.5, 1.25).fillOpacity(0.28).fill('#FFF3E6').restore()
    }
    // the dinghy
    pdf.save().translate(300, H + 40).scale(1.1)
    pdf.path('M-22 0 L22 0 L15 9 L-16 9 Z').fill('#1B2A4A')
    pdf.moveTo(0, 0).lineTo(0, -40).lineWidth(1.8).stroke('#1B2A4A')
    pdf.path('M1.5 -38 L1.5 -3 L20 -3 Z').fill('#1B2A4A')
    pdf.fillOpacity(0.75).path('M-1.5 -30 L-1.5 -3 L-14 -3 Z').fill('#1B2A4A')
    pdf.restore()
    pdf.restore()
}

export function renderPdf(doc: DinghyDoc): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const pdf = new PDFDocument({ bufferPages: true, size: 'LETTER', margins: { top: 64, bottom: 64, left: 64, right: 64 }, info: { Title: doc.title, Creator: 'Dinghy' } })
        const chunks: Buffer[] = []
        pdf.on('data', (c: Buffer) => chunks.push(c))
        pdf.on('end', () => resolve(Buffer.concat(chunks)))
        pdf.on('error', reject)

        pdf.registerFont('display', Buffer.from(frauncesDisplay, 'base64'))
        pdf.registerFont('displayItalic', Buffer.from(frauncesItalic, 'base64'))
        pdf.registerFont('body', Buffer.from(schibsted400, 'base64'))
        pdf.registerFont('bodyBold', Buffer.from(schibsted600, 'base64'))
        pdf.registerFont('mono', Buffer.from(dmMono500, 'base64'))

        const L = pdf.page.margins.left
        const W = pdf.page.width - L - pdf.page.margins.right
        const paint = () => {
            pdf.save().rect(0, 0, pdf.page.width, pdf.page.height).fill(BRAND.paper).restore()
        }
        paint()
        const STRIP = 150
        drawSunriseStrip(pdf, pdf.page.width, STRIP)
        pdf.on('pageAdded', () => {
            paint()
            pdf.x = L
        })
        const rule = (gapBefore = 10, gapAfter = 14) => {
            pdf.moveDown(0).y += gapBefore
            pdf.save().moveTo(L, pdf.y).lineTo(L + W, pdf.y).lineWidth(0.6).strokeColor(BRAND.line).stroke().restore()
            pdf.y += gapAfter
        }
        const ensure = (h: number) => {
            if (pdf.y + h > pdf.page.height - pdf.page.margins.bottom) pdf.addPage()
        }
        const inline = (text: string, x: number, width: number, size = 11, color: string = BRAND.body) => {
            const rs = runs(text)
            rs.forEach((r, i) => {
                pdf.font(r.bold ? 'bodyBold' : 'body').fontSize(size).fillColor(color)
                pdf.text(r.text, i === 0 ? x : undefined, i === 0 ? pdf.y : undefined, { width, lineGap: 3, continued: i < rs.length - 1 })
            })
            if (!rs.length) pdf.text('', x, pdf.y)
        }

        // Header
        pdf.font('mono').fontSize(8.5).fillColor(BRAND.accent).text('DINGHY', L, STRIP + 34, { characterSpacing: 1.6 })
        pdf.moveDown(0.7)
        pdf.font('display').fontSize(32).fillColor(BRAND.ink).text(plain(doc.title), L, pdf.y, { width: W, lineGap: 1 })
        if (doc.subtitle) {
            pdf.moveDown(0.25)
            pdf.font('body').fontSize(12).fillColor(BRAND.body).text(plain(doc.subtitle), L, pdf.y, { width: W })
        }
        pdf.moveDown(0.8)

        for (const t of tokens(doc.body)) {
            pdf.x = L
            if (t.type === 'heading') {
                const h = t as Tokens.Heading
                if (h.depth <= 2) {
                    ensure(70)
                    rule(8, 14)
                    pdf.font('display').fontSize(19).fillColor(BRAND.ink).text(plain(h.text), L, pdf.y, { width: W })
                    pdf.moveDown(0.35)
                } else {
                    ensure(40)
                    pdf.moveDown(0.4)
                    pdf.font('bodyBold').fontSize(11.5).fillColor(BRAND.ink).text(plain(h.text), L, pdf.y, { width: W })
                    pdf.moveDown(0.2)
                }
            } else if (t.type === 'paragraph') {
                ensure(30)
                inline((t as Tokens.Paragraph).text, L, W)
                pdf.moveDown(0.5)
            } else if (t.type === 'list') {
                const l = t as Tokens.List
                l.items.forEach((it, i) => {
                    ensure(24)
                    const tr = splitTimeRow(it.text)
                    const y = pdf.y
                    if (tr) {
                        pdf.font('mono').fontSize(9.5).fillColor(BRAND.accent).text(tr.time, L, y + 1.5, { width: 80 })
                        pdf.y = y
                        inline(tr.rest, L + 88, W - 88)
                    } else {
                        const mark = l.ordered ? `${(Number(l.start) || 1) + i}.` : '•'
                        pdf.font(l.ordered ? 'mono' : 'bodyBold').fontSize(l.ordered ? 9.5 : 11).fillColor(BRAND.accent).text(mark, L + 2, y + (l.ordered ? 1.5 : 0), { width: 18 })
                        pdf.y = y
                        inline(it.text, L + 20, W - 20)
                    }
                    pdf.moveDown(0.35)
                })
                pdf.moveDown(0.3)
            } else if (t.type === 'table') {
                const tb = t as Tokens.Table
                const cols = tb.header.length || 1
                const cw = W / cols
                ensure(40)
                let y = pdf.y
                tb.header.forEach((c, i) =>
                    pdf.font('mono').fontSize(8.5).fillColor(BRAND.mute).text(plain(c.text).toUpperCase(), L + i * cw, y, { width: cw - 8, characterSpacing: 1 })
                )
                y = pdf.y + 6
                pdf.save().moveTo(L, y).lineTo(L + W, y).lineWidth(0.6).strokeColor(BRAND.line).stroke().restore()
                pdf.y = y + 7
                for (const row of tb.rows) {
                    ensure(26)
                    const top = pdf.y
                    let bottom = top
                    row.forEach((c, i) => {
                        pdf.font('body').fontSize(10.5).fillColor(BRAND.ink).text(plain(c.text), L + i * cw, top, { width: cw - 8 })
                        bottom = Math.max(bottom, pdf.y)
                    })
                    pdf.y = bottom + 5
                    pdf.save().moveTo(L, pdf.y).lineTo(L + W, pdf.y).lineWidth(0.4).strokeColor(BRAND.line).stroke().restore()
                    pdf.y += 7
                }
                pdf.moveDown(0.4)
            } else if (t.type === 'blockquote') {
                ensure(40)
                const text = plain((t as Tokens.Blockquote).text)
                const top = pdf.y
                pdf.font('displayItalic').fontSize(12.5).fillColor(BRAND.ink).text(text, L + 14, top, { width: W - 14, lineGap: 3 })
                pdf.save().rect(L, top, 2, pdf.y - top).fill(BRAND.accent).restore()
                pdf.moveDown(0.6)
            } else if (t.type === 'code') {
                ensure(30)
                pdf.font('mono').fontSize(9.5).fillColor(BRAND.ink).text((t as Tokens.Code).text, L + 10, pdf.y, { width: W - 20 })
                pdf.moveDown(0.5)
            } else if (t.type === 'hr') {
                rule(4, 12)
            }
        }

        // Footer on every page
        const range = pdf.bufferedPageRange()
        for (let i = range.start; i < range.start + range.count; i++) {
            pdf.switchToPage(i)
            const savedBottom = pdf.page.margins.bottom
            pdf.page.margins.bottom = 0 // writing in the margin must not spawn a page
            const fy = pdf.page.height - 40
            pdf.font('mono').fontSize(8).fillColor(BRAND.mute)
            pdf.text('made by dinghy · getdinghy.sh', L, fy, { width: W / 2, lineBreak: false })
            pdf.text(`${i + 1} / ${range.count}`, L + W / 2, fy, { width: W / 2, align: 'right', lineBreak: false })
            pdf.page.margins.bottom = savedBottom
        }
        pdf.end()
    })
}

// ── DOCX ─────────────────────────────────────────────────────────────────────

const hex = (c: string) => c.replace('#', '')

export async function renderDocx(doc: DinghyDoc): Promise<Buffer> {
    const kids: (Paragraph | Table)[] = []
    const run = (r: Run, size = 22, color: string = BRAND.body) => new TextRun({ text: r.text, bold: r.bold, font: 'Schibsted Grotesk', size, color: hex(color) })
    kids.push(new Paragraph({ children: [new TextRun({ text: 'DINGHY', font: 'DM Mono', size: 17, color: hex(BRAND.accent), characterSpacing: 40 })], spacing: { after: 120 } }))
    kids.push(new Paragraph({ children: [new TextRun({ text: plain(doc.title), font: 'Fraunces', size: 60, color: hex(BRAND.ink) })], spacing: { after: 80 } }))
    if (doc.subtitle) kids.push(new Paragraph({ children: [new TextRun({ text: plain(doc.subtitle), font: 'Schibsted Grotesk', size: 23, color: hex(BRAND.mute) })], spacing: { after: 240 } }))

    for (const t of tokens(doc.body)) {
        if (t.type === 'heading') {
            const h = t as Tokens.Heading
            kids.push(
                h.depth <= 2
                    ? new Paragraph({
                          children: [new TextRun({ text: plain(h.text), font: 'Fraunces', size: 36, color: hex(BRAND.ink) })],
                          border: { top: { style: BorderStyle.SINGLE, size: 4, color: hex(BRAND.line), space: 12 } },
                          spacing: { before: 320, after: 120 },
                      })
                    : new Paragraph({ children: [run({ text: plain(h.text), bold: true }, 23)], spacing: { before: 200, after: 60 } })
            )
        } else if (t.type === 'paragraph') {
            kids.push(new Paragraph({ children: runs((t as Tokens.Paragraph).text).map((r) => run(r)), spacing: { after: 140, line: 300 } }))
        } else if (t.type === 'list') {
            const l = t as Tokens.List
            l.items.forEach((it, i) => {
                const tr = splitTimeRow(it.text)
                const lead = tr ? tr.time : l.ordered ? `${(Number(l.start) || 1) + i}.` : '•'
                kids.push(
                    new Paragraph({
                        children: [
                            new TextRun({ text: lead, font: tr || l.ordered ? 'DM Mono' : 'Schibsted Grotesk', size: tr || l.ordered ? 19 : 22, color: hex(BRAND.accent), bold: !tr && !l.ordered }),
                            new TextRun({ text: '\t' }),
                            ...runs(tr ? tr.rest : it.text).map((r) => run(r)),
                        ],
                        tabStops: [{ type: 'left', position: tr ? 1300 : 360 }],
                        indent: { left: tr ? 1300 : 360, hanging: tr ? 1300 : 360 },
                        spacing: { after: 80 },
                    })
                )
            })
        } else if (t.type === 'table') {
            const tb = t as Tokens.Table
            const border = { style: BorderStyle.SINGLE, size: 4, color: hex(BRAND.line) }
            const none = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }
            const cell = (text: string, head: boolean) =>
                new TableCell({
                    children: [new Paragraph({ children: [head ? new TextRun({ text: plain(text).toUpperCase(), font: 'DM Mono', size: 16, color: hex(BRAND.mute) }) : run({ text: plain(text) }, 20)] })],
                    borders: { top: none, left: none, right: none, bottom: border },
                    margins: { top: 80, bottom: 80, left: 80, right: 80 },
                })
            kids.push(
                new Table({
                    width: { size: 100, type: WidthType.PERCENTAGE },
                    rows: [new TableRow({ children: tb.header.map((c) => cell(c.text, true)) }), ...tb.rows.map((r) => new TableRow({ children: r.map((c) => cell(c.text, false)) }))],
                })
            )
            kids.push(new Paragraph({ children: [], spacing: { after: 120 } }))
        } else if (t.type === 'blockquote') {
            kids.push(
                new Paragraph({
                    children: [new TextRun({ text: plain((t as Tokens.Blockquote).text), font: 'Fraunces', italics: true, size: 25, color: hex(BRAND.ink) })],
                    border: { left: { style: BorderStyle.SINGLE, size: 12, color: hex(BRAND.accent), space: 10 } },
                    spacing: { before: 120, after: 160 },
                })
            )
        } else if (t.type === 'code') {
            kids.push(new Paragraph({ children: [new TextRun({ text: (t as Tokens.Code).text, font: 'DM Mono', size: 19 })], spacing: { after: 140 } }))
        } else if (t.type === 'hr') {
            kids.push(new Paragraph({ children: [], border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: hex(BRAND.line), space: 1 } }, spacing: { after: 200 } }))
        }
    }
    kids.push(
        new Paragraph({
            children: [new TextRun({ text: 'made by dinghy · getdinghy.sh', font: 'DM Mono', size: 16, color: hex(BRAND.mute) })],
            border: { top: { style: BorderStyle.SINGLE, size: 4, color: hex(BRAND.line), space: 10 } },
            spacing: { before: 480 },
            alignment: AlignmentType.LEFT,
        })
    )
    const d = new Document({
        creator: 'Dinghy',
        title: doc.title,
        background: { color: hex(BRAND.paper) },
        styles: { default: { document: { run: { font: 'Schibsted Grotesk', size: 22, color: hex(BRAND.body) } } } },
        sections: [{ properties: { page: { margin: { top: 1100, bottom: 1100, left: 1150, right: 1150 } } }, children: kids }],
    })
    return Buffer.from(await Packer.toBuffer(d))
}

// ── CSV ──────────────────────────────────────────────────────────────────────

/** First markdown table in the body as CSV (or the body itself if it already looks like CSV). */
export function renderCsv(doc: DinghyDoc): string {
    const table = tokens(doc.body).find((t) => t.type === 'table') as Tokens.Table | undefined
    if (!table) return doc.body.trim() + '\n'
    const cell = (s: string) => {
        const v = plain(s)
        return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
    }
    return [table.header.map((c) => cell(c.text)).join(','), ...table.rows.map((r) => r.map((c) => cell(c.text)).join(','))].join('\n') + '\n'
}

export async function renderFile(doc: DinghyDoc, format: FileFormat, html: HtmlOptions = {}): Promise<RenderedFile> {
    const base = slugify(doc.title)
    const bytes =
        format === 'pdf'
            ? await renderPdf(doc)
            : format === 'docx'
              ? await renderDocx(doc)
              : format === 'html'
                ? Buffer.from(renderHtml(doc, html), 'utf8')
                : format === 'csv'
                  ? Buffer.from(renderCsv(doc), 'utf8')
                  : Buffer.from(`# ${doc.title}\n\n${doc.subtitle ? `_${doc.subtitle}_\n\n` : ''}${doc.body.trim()}\n`, 'utf8')
    return { filename: `${base}.${format}`, mimeType: MIME[format], bytes }
}
