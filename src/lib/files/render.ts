/**
 * Dinghy file renderer. One document model (title + markdown body) rendered
 * three ways in Dinghy's design language (getdinghy.sh):
 *   - HTML  navy page, Playfair headings, Inter body, JetBrains Mono accents
 *           (share pages; carries OG tags for the iMessage link card)
 *   - PDF   the same system on cream paper, fonts embedded (pdfkit)
 *   - DOCX  same fonts/colors as Word styles (docx)
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
import { inter400, inter600, mono500, playfair400i, playfair600 } from './fonts'

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
    navy: '#050a18',
    panel: '#0a1226',
    ink: '#e8eef6',
    mute: '#8fa3bd',
    line: '#1b2a44',
    accent: '#6b9ce0',
    paper: '#faf8f2',
    paperInk: '#0b1a33',
    paperMute: '#5d6b80',
    paperLine: '#e3ddd0',
    paperAccent: '#2f5fa8',
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
    const desc = opts.description ?? doc.subtitle ?? 'Made by Dinghy, your AI first mate.'
    const og = opts.ogImage
        ? `<meta property="og:image" content="${esc(opts.ogImage)}"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta name="twitter:card" content="summary_large_image">`
        : ''
    return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(doc.title)} · Dinghy</title>
<meta name="description" content="${esc(desc)}">
<meta property="og:title" content="${esc(doc.title)}"><meta property="og:description" content="${esc(desc)}">
<meta property="og:site_name" content="Dinghy"><meta property="og:type" content="article">${og}
<meta name="robots" content="noindex"><meta name="theme-color" content="${BRAND.navy}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,600;1,400&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
:root{--bg:${BRAND.navy};--panel:${BRAND.panel};--ink:${BRAND.ink};--mute:${BRAND.mute};--line:${BRAND.line};--accent:${BRAND.accent}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.65 Inter,system-ui,sans-serif;-webkit-font-smoothing:antialiased}
.wrap{max-width:720px;margin:0 auto;padding:56px 24px 72px}
.brand{font:500 12px/1 'JetBrains Mono',monospace;letter-spacing:.16em;text-transform:uppercase;color:var(--accent)}
h1{font:600 44px/1.1 'Playfair Display',serif;margin:14px 0 8px;letter-spacing:-.01em}
.sub{color:var(--mute);margin:0 0 28px}
.sec{border-top:1px solid var(--line);margin-top:28px;padding-top:22px}
h2{font:italic 400 26px/1.2 'Playfair Display',serif;margin:0 0 6px}
h3{font:600 15px/1.4 Inter,sans-serif;margin:20px 0 6px;color:var(--ink)}
p{margin:10px 0}a{color:var(--accent)}strong{font-weight:600;color:#fff}
ul,ol{padding-left:22px}li{margin:6px 0}li::marker{color:var(--accent)}
.rows{margin:6px 0}.row{display:grid;grid-template-columns:96px 1fr;gap:12px;padding:7px 0}
.t{font:500 13px/1.7 'JetBrains Mono',monospace;color:var(--accent)}
table{width:100%;border-collapse:collapse;margin:14px 0;font-size:14px}
th{font:500 11px 'JetBrains Mono',monospace;letter-spacing:.1em;text-transform:uppercase;color:var(--mute);text-align:left;padding:8px 10px;border-bottom:1px solid var(--line)}
td{padding:9px 10px;border-bottom:1px solid var(--line)}
blockquote{margin:16px 0;padding:10px 16px;border-left:2px solid var(--accent);background:var(--panel);color:var(--ink)}
code{font:13px 'JetBrains Mono',monospace;background:var(--panel);padding:1px 5px;border-radius:4px}
hr{border:0;border-top:1px solid var(--line);margin:28px 0}
.foot{margin-top:44px;padding-top:18px;border-top:1px solid var(--line);font:12px 'JetBrains Mono',monospace;color:var(--mute)}
</style></head>
<body><div class="wrap">
<div class="brand">⚓&nbsp; Dinghy</div>
<h1>${esc(doc.title)}</h1>
${doc.subtitle ? `<p class="sub">${esc(doc.subtitle)}</p>` : ''}
${body.join('\n')}
<div class="foot">made by dinghy · getdinghy.sh</div>
</div></body></html>`
}

// ── PDF ──────────────────────────────────────────────────────────────────────

export function renderPdf(doc: DinghyDoc): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const pdf = new PDFDocument({ bufferPages: true, size: 'LETTER', margins: { top: 64, bottom: 64, left: 64, right: 64 }, info: { Title: doc.title, Creator: 'Dinghy' } })
        const chunks: Buffer[] = []
        pdf.on('data', (c: Buffer) => chunks.push(c))
        pdf.on('end', () => resolve(Buffer.concat(chunks)))
        pdf.on('error', reject)

        pdf.registerFont('display', Buffer.from(playfair600, 'base64'))
        pdf.registerFont('displayItalic', Buffer.from(playfair400i, 'base64'))
        pdf.registerFont('body', Buffer.from(inter400, 'base64'))
        pdf.registerFont('bodyBold', Buffer.from(inter600, 'base64'))
        pdf.registerFont('mono', Buffer.from(mono500, 'base64'))

        const L = pdf.page.margins.left
        const W = pdf.page.width - L - pdf.page.margins.right
        const paint = () => {
            pdf.save().rect(0, 0, pdf.page.width, pdf.page.height).fill(BRAND.paper).restore()
            pdf.save().rect(0, 0, pdf.page.width, 6).fill(BRAND.paperInk).restore()
        }
        paint()
        pdf.on('pageAdded', () => {
            paint()
            pdf.x = L
        })
        const rule = (gapBefore = 10, gapAfter = 14) => {
            pdf.moveDown(0).y += gapBefore
            pdf.save().moveTo(L, pdf.y).lineTo(L + W, pdf.y).lineWidth(0.6).strokeColor(BRAND.paperLine).stroke().restore()
            pdf.y += gapAfter
        }
        const ensure = (h: number) => {
            if (pdf.y + h > pdf.page.height - pdf.page.margins.bottom) pdf.addPage()
        }
        const inline = (text: string, x: number, width: number, size = 11, color: string = BRAND.paperInk) => {
            const rs = runs(text)
            rs.forEach((r, i) => {
                pdf.font(r.bold ? 'bodyBold' : 'body').fontSize(size).fillColor(color)
                pdf.text(r.text, i === 0 ? x : undefined, i === 0 ? pdf.y : undefined, { width, lineGap: 3, continued: i < rs.length - 1 })
            })
            if (!rs.length) pdf.text('', x, pdf.y)
        }

        // Header
        pdf.font('mono').fontSize(9).fillColor(BRAND.paperAccent).text('DINGHY', L, 58, { characterSpacing: 2.2 })
        pdf.moveDown(0.6)
        pdf.font('display').fontSize(30).fillColor(BRAND.paperInk).text(plain(doc.title), L, pdf.y, { width: W, lineGap: 2 })
        if (doc.subtitle) {
            pdf.moveDown(0.25)
            pdf.font('body').fontSize(11.5).fillColor(BRAND.paperMute).text(plain(doc.subtitle), L, pdf.y, { width: W })
        }
        pdf.moveDown(0.8)

        for (const t of tokens(doc.body)) {
            pdf.x = L
            if (t.type === 'heading') {
                const h = t as Tokens.Heading
                if (h.depth <= 2) {
                    ensure(70)
                    rule(8, 14)
                    pdf.font('displayItalic').fontSize(18).fillColor(BRAND.paperInk).text(plain(h.text), L, pdf.y, { width: W })
                    pdf.moveDown(0.35)
                } else {
                    ensure(40)
                    pdf.moveDown(0.4)
                    pdf.font('bodyBold').fontSize(11.5).fillColor(BRAND.paperInk).text(plain(h.text), L, pdf.y, { width: W })
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
                        pdf.font('mono').fontSize(9.5).fillColor(BRAND.paperAccent).text(tr.time, L, y + 1.5, { width: 80 })
                        pdf.y = y
                        inline(tr.rest, L + 88, W - 88)
                    } else {
                        const mark = l.ordered ? `${(Number(l.start) || 1) + i}.` : '•'
                        pdf.font(l.ordered ? 'mono' : 'bodyBold').fontSize(l.ordered ? 9.5 : 11).fillColor(BRAND.paperAccent).text(mark, L + 2, y + (l.ordered ? 1.5 : 0), { width: 18 })
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
                    pdf.font('mono').fontSize(8.5).fillColor(BRAND.paperMute).text(plain(c.text).toUpperCase(), L + i * cw, y, { width: cw - 8, characterSpacing: 1 })
                )
                y = pdf.y + 6
                pdf.save().moveTo(L, y).lineTo(L + W, y).lineWidth(0.6).strokeColor(BRAND.paperLine).stroke().restore()
                pdf.y = y + 7
                for (const row of tb.rows) {
                    ensure(26)
                    const top = pdf.y
                    let bottom = top
                    row.forEach((c, i) => {
                        pdf.font('body').fontSize(10.5).fillColor(BRAND.paperInk).text(plain(c.text), L + i * cw, top, { width: cw - 8 })
                        bottom = Math.max(bottom, pdf.y)
                    })
                    pdf.y = bottom + 5
                    pdf.save().moveTo(L, pdf.y).lineTo(L + W, pdf.y).lineWidth(0.4).strokeColor(BRAND.paperLine).stroke().restore()
                    pdf.y += 7
                }
                pdf.moveDown(0.4)
            } else if (t.type === 'blockquote') {
                ensure(40)
                const text = plain((t as Tokens.Blockquote).text)
                const top = pdf.y
                pdf.font('displayItalic').fontSize(12.5).fillColor(BRAND.paperInk).text(text, L + 14, top, { width: W - 14, lineGap: 3 })
                pdf.save().rect(L, top, 2, pdf.y - top).fill(BRAND.paperAccent).restore()
                pdf.moveDown(0.6)
            } else if (t.type === 'code') {
                ensure(30)
                pdf.font('mono').fontSize(9.5).fillColor(BRAND.paperInk).text((t as Tokens.Code).text, L + 10, pdf.y, { width: W - 20 })
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
            pdf.font('mono').fontSize(8).fillColor(BRAND.paperMute)
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
    const run = (r: Run, size = 22, color = BRAND.paperInk) => new TextRun({ text: r.text, bold: r.bold, font: 'Inter', size, color: hex(color) })
    kids.push(new Paragraph({ children: [new TextRun({ text: 'DINGHY', font: 'JetBrains Mono', size: 17, color: hex(BRAND.paperAccent), characterSpacing: 40 })], spacing: { after: 120 } }))
    kids.push(new Paragraph({ children: [new TextRun({ text: plain(doc.title), font: 'Playfair Display', bold: true, size: 56, color: hex(BRAND.paperInk) })], spacing: { after: 80 } }))
    if (doc.subtitle) kids.push(new Paragraph({ children: [new TextRun({ text: plain(doc.subtitle), font: 'Inter', size: 23, color: hex(BRAND.paperMute) })], spacing: { after: 240 } }))

    for (const t of tokens(doc.body)) {
        if (t.type === 'heading') {
            const h = t as Tokens.Heading
            kids.push(
                h.depth <= 2
                    ? new Paragraph({
                          children: [new TextRun({ text: plain(h.text), font: 'Playfair Display', italics: true, size: 34, color: hex(BRAND.paperInk) })],
                          border: { top: { style: BorderStyle.SINGLE, size: 4, color: hex(BRAND.paperLine), space: 12 } },
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
                            new TextRun({ text: lead, font: tr || l.ordered ? 'JetBrains Mono' : 'Inter', size: tr || l.ordered ? 19 : 22, color: hex(BRAND.paperAccent), bold: !tr && !l.ordered }),
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
            const border = { style: BorderStyle.SINGLE, size: 4, color: hex(BRAND.paperLine) }
            const none = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }
            const cell = (text: string, head: boolean) =>
                new TableCell({
                    children: [new Paragraph({ children: [head ? new TextRun({ text: plain(text).toUpperCase(), font: 'JetBrains Mono', size: 16, color: hex(BRAND.paperMute) }) : run({ text: plain(text) }, 20)] })],
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
                    children: [new TextRun({ text: plain((t as Tokens.Blockquote).text), font: 'Playfair Display', italics: true, size: 25, color: hex(BRAND.paperInk) })],
                    border: { left: { style: BorderStyle.SINGLE, size: 12, color: hex(BRAND.paperAccent), space: 10 } },
                    spacing: { before: 120, after: 160 },
                })
            )
        } else if (t.type === 'code') {
            kids.push(new Paragraph({ children: [new TextRun({ text: (t as Tokens.Code).text, font: 'JetBrains Mono', size: 19 })], spacing: { after: 140 } }))
        } else if (t.type === 'hr') {
            kids.push(new Paragraph({ children: [], border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: hex(BRAND.paperLine), space: 1 } }, spacing: { after: 200 } }))
        }
    }
    kids.push(
        new Paragraph({
            children: [new TextRun({ text: 'made by dinghy · getdinghy.sh', font: 'JetBrains Mono', size: 16, color: hex(BRAND.paperMute) })],
            border: { top: { style: BorderStyle.SINGLE, size: 4, color: hex(BRAND.paperLine), space: 10 } },
            spacing: { before: 480 },
            alignment: AlignmentType.LEFT,
        })
    )
    const d = new Document({
        creator: 'Dinghy',
        title: doc.title,
        background: { color: hex(BRAND.paper) },
        styles: { default: { document: { run: { font: 'Inter', size: 22, color: hex(BRAND.paperInk) } } } },
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
