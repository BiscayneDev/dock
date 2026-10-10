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
import { Marked, marked, type Token, type Tokens } from 'marked'
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

/** Link targets a shared page may carry. Anything else (javascript:, data:, vbscript:) renders as plain text. */
export function safeHref(href: string): boolean {
    // eslint-disable-next-line no-control-regex
    const h = href.replace(/[\u0000-\u0020]/g, '')
    return /^(https?:|mailto:|tel:|sms:|#|\/)/i.test(h)
}

/**
 * Markdown to HTML for shared pages. The text comes from a model that reads the
 * web and email, so it is untrusted: raw HTML is shown as text, links are limited
 * to safe schemes, and images are dropped (no remote fetches from the page).
 */
const safe = new Marked({
    renderer: {
        html({ text }) {
            return esc(text)
        },
        link({ href, title, tokens }) {
            const text = this.parser.parseInline(tokens)
            if (!safeHref(href)) return text
            return `<a href="${esc(href)}"${title ? ` title="${esc(title)}"` : ''}>${text}</a>`
        },
        image({ text }) {
            return esc(text)
        },
    },
})

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
    return marked.lexer(flattenBlocks(md ?? ''))
}


// ── Components: ":::name" blocks ─────────────────────────────────────────────
// The model writes plain Markdown; our code draws the components. Unknown block
// names are left as ordinary text. Blocks never contain raw HTML (all escaped).
const BLOCK_NAMES = ['facts', 'cost', 'heads-up', 'place', 'places', 'reply', 'options', 'sources'] as const
type BlockName = (typeof BLOCK_NAMES)[number]
type Segment = { kind: 'md'; text: string } | { kind: 'block'; name: BlockName; lines: string[] }

export function splitBlocks(md: string): Segment[] {
    const out: Segment[] = []
    let buf: string[] = []
    const flush = () => {
        if (buf.length) out.push({ kind: 'md', text: buf.join('\n') })
        buf = []
    }
    const lines = (md ?? '').split('\n')
    for (let i = 0; i < lines.length; i++) {
        const open = lines[i].match(/^\s*:::\s*(facts|cost|heads-up|places|place|reply|options|sources)\s*$/i)
        if (open) {
            const end = lines.findIndex((l, j) => j > i && /^\s*:::\s*$/.test(l))
            if (end > i) {
                flush()
                out.push({ kind: 'block', name: open[1].toLowerCase() as BlockName, lines: lines.slice(i + 1, end).map((l) => l.trim()).filter(Boolean).slice(0, 12) })
                i = end
                continue
            }
        }
        buf.push(lines[i])
    }
    flush()
    return out
}

/** "Label: value" -> pair. Lines with no label keep an empty label. */
function pair(line: string): { k: string; v: string } {
    const m = line.match(/^([^:]{1,28}):\s*(.+)$/)
    return m ? { k: m[1].trim(), v: m[2].trim() } : { k: '', v: line }
}

/**
 * Place cards: "Name | state | status text | distance/walk | address | hours | lat,lon | website | phone".
 * state is open, closed or unknown and drives the badge colour. Map links come from
 * the coordinates (or the address); website must be plain http(s).
 */
function renderPlaces(lines: string[]): string {
    const cards = lines.slice(0, 8).map((l) => {
        const [name, state, status, dist, address, hours, ll, site, phone] = cells(l)
        if (!name) return ''
        const st = state === 'open' || state === 'closed' ? state : 'unknown'
        const m = (ll ?? '').match(/^(-?\d{1,3}(?:\.\d+)?),\s*(-?\d{1,3}(?:\.\d+)?)$/)
        const apple = m ? `https://maps.apple.com/?ll=${m[1]},${m[2]}&q=${encodeURIComponent(name)}` : address ? `https://maps.apple.com/?q=${encodeURIComponent(address)}` : ''
        const google = m ? `https://www.google.com/maps/search/?api=1&query=${m[1]},${m[2]}` : ''
        const { tel } = placeLinks('', phone ?? '')
        const web = site && /^https?:\/\/[^\s\u0000-\u001f]+$/i.test(site) ? site : ''
        const acts = [apple && `<a href="${esc(apple)}" target="_blank" rel="noopener noreferrer">Apple Maps</a>`, google && `<a href="${esc(google)}" target="_blank" rel="noopener noreferrer">Google Maps</a>`, tel && `<a href="${esc(tel)}">Call</a>`, web && `<a href="${esc(web)}" target="_blank" rel="noopener noreferrer">Website</a>`].filter(Boolean).join('')
        return `<div class="plc"><div class="plc-top"><span class="plc-name">${esc(name)}</span>${dist ? `<span class="plc-dist">${esc(dist)}</span>` : ''}</div><div class="plc-badge plc-${st}">${esc(status || 'Hours not listed')}</div>${address ? `<div class="pm">${esc(address)}</div>` : ''}${hours ? `<div class="pm plc-hours">${esc(hours)}</div>` : ''}${acts ? `<div class="pa">${acts}</div>` : ''}</div>`
    })
    return `<div class="plcs">${cards.join('')}</div>`
}

/** Safe map and phone links for a place block. */
export function placeLinks(address: string, phone: string): { map: string | null; tel: string | null } {
    const map = address ? `https://maps.apple.com/?q=${encodeURIComponent(address)}` : null
    const digits = phone.replace(/[^\d+]/g, '')
    return { map, tel: /^\+?\d{7,15}$/.test(digits) ? `tel:${digits}` : null }
}


const E164 = /^\+[1-9]\d{7,14}$/

/** An sms: link that opens Messages to the given line with the text filled in. The user still taps Send. */
export function replyHref(line: string, text: string): string | null {
    return E164.test(line) && text ? `sms:${line}?&body=${encodeURIComponent(text)}` : null
}

/** Up to 3 tap-to-reply buttons. Without a line to text they show as plain suggestions, never as dead links. */
function renderReplies(lines: string[], line?: string): string {
    const texts = lines.map((l) => l.replace(/^[-*]\s+/, '').trim()).filter((l) => l && l.length <= 120).slice(0, 3)
    if (!texts.length) return ''
    const items = texts.map((t) => {
        const href = line ? replyHref(line, t) : null
        return href
            ? `<a class="reply" href="${esc(href)}"><span class="reply-k">Reply</span><span class="reply-t">${esc(t)}</span></a>`
            : `<div class="reply reply-off"><span class="reply-k">Say</span><span class="reply-t">${esc(t)}</span></div>`
    })
    return `<div class="replies"><p class="reply-hint">${line ? 'Tap to reply' : 'You can text me'}</p>${items.join('')}</div>`
}


const cells = (line: string): string[] => line.split('|').map((c) => c.trim())

/** Option cards: "Name | price | why | catch" per line, up to 5. The catch is shown on purpose. */
function renderOptions(lines: string[]): string {
    const cards = lines.slice(0, 5).map((l) => {
        const [name, price, why, notes] = cells(l)
        if (!name) return ''
        return `<div class="opt"><div class="opt-top"><span class="opt-name">${esc(name)}</span>${price ? `<span class="opt-price">${esc(price)}</span>` : ''}</div>${why ? `<p class="opt-why">${esc(why)}</p>` : ''}${notes ? `<p class="opt-catch"><span>Catch</span>${esc(notes)}</p>` : ''}</div>`
    })
    return `<div class="opts">${cards.join('')}</div>`
}

const hostOf = (url: string): string => {
    try { return new URL(url).hostname.replace(/^www\./, '') } catch { return '' }
}

/** Sources: "What it backs | https://link | date" per line. Each claim shows where it came from and when. */
function renderSources(lines: string[]): string {
    const rows = lines.slice(0, 10).map((l) => {
        const [what, url, date] = cells(l)
        if (!what) return ''
        const ok = !!url && /^https?:\/\/[^\s\u0000-\u001f]+$/i.test(url)
        const label = ok ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(what)}</a>` : esc(what)
        const meta = [ok ? hostOf(url) : '', date ? `checked ${date}` : ''].filter(Boolean).join(' · ')
        return `<li>${label}${meta ? `<span class="src-meta">${esc(meta)}</span>` : ''}</li>`
    })
    return `<div class="sources"><span class="src-label">sources</span><ol>${rows.join('')}</ol></div>`
}

function renderBlock(name: BlockName, lines: string[], opts: HtmlOptions = {}): string {
    const inline = (t: string) => safe.parseInline(t) as string
    if (name === 'facts') {
        const chips = lines.slice(0, 8).map(pair).map((p) => `<div class="fact"><span class="fk">${esc(p.k)}</span><span class="fv">${inline(p.v)}</span></div>`)
        return `<div class="facts">${chips.join('')}</div>`
    }
    if (name === 'cost') {
        const items = lines.map(pair)
        const rows = items.map((p) => {
            const total = /^total/i.test(p.k)
            return `<div class="crow${total ? ' ctotal' : ''}"><span>${esc(p.k)}</span><span>${inline(p.v)}</span></div>`
        })
        const hasTotal = items.some((p) => /^total/i.test(p.k))
        const note = hasTotal ? '' : '<p class="cnote">No total given. Ask Dinghy for the all-in price.</p>'
        return `<div class="cost">${rows.join('')}${note}</div>`
    }
    if (name === 'heads-up') {
        return `<aside class="heads"><span class="heads-label">heads up</span>${lines.map((l) => `<p>${inline(l)}</p>`).join('')}</aside>`
    }
    if (name === 'reply') return renderReplies(lines, opts.replyLine)
    if (name === 'options') return renderOptions(lines)
    if (name === 'places') return renderPlaces(lines)
    if (name === 'sources') return renderSources(lines)
    // place
    const f = Object.fromEntries(lines.map(pair).map((p) => [p.k.toLowerCase(), p.v]))
    const title = f['name'] ?? lines[0] ?? 'Place'
    const { map, tel } = placeLinks(f['address'] ?? '', f['phone'] ?? '')
    const meta = [f['address'], f['hours']].filter(Boolean).map((t) => `<div class="pm">${esc(t)}</div>`).join('')
    const acts = `${map ? `<a href="${esc(map)}" target="_blank" rel="noopener noreferrer">Map</a>` : ''}${tel ? `<a href="${esc(tel)}">Call</a>` : ''}`
    return `<div class="place"><div class="pn">${esc(title)}</div>${meta}${acts ? `<div class="pa">${acts}</div>` : ''}</div>`
}

/** Plain-Markdown form of the blocks, for PDF and DOCX (and anything that does not draw components). */
export function flattenBlocks(md: string): string {
    return splitBlocks(md)
        .map((sg) => {
            if (sg.kind === 'md') return sg.text
            if (sg.name === 'heads-up') return `> Heads up: ${sg.lines.join(' ')}`
            if (sg.name === 'reply') return sg.lines.slice(0, 3).map((l) => `- Reply with: ${l.replace(/^[-*]\s+/, '')}`).join('\n')
            if (sg.name === 'options') return sg.lines.slice(0, 5).map((l) => { const [n, p, w, c] = cells(l); return `- ${[n, p, w].filter(Boolean).join(' - ')}${c ? ` (catch: ${c})` : ''}` }).join('\n')
            if (sg.name === 'places') return sg.lines.slice(0, 8).map((l) => { const [n, , st, d, a, h] = cells(l); return `- ${[n, st, d, a, h && `hours ${h}`].filter(Boolean).join(', ')}` }).join('\n')
            if (sg.name === 'sources') return sg.lines.slice(0, 10).map((l) => { const [w, u, d] = cells(l); return `- ${[w, u, d && `checked ${d}`].filter(Boolean).join(', ')}` }).join('\n')
            return sg.lines.map((l) => `- ${l}`).join('\n')
        })
        .join('\n')
}

const DAY_HEAD = /^(?:day\s*\d+|(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*\b)/i

// ── HTML ─────────────────────────────────────────────────────────────────────

export interface HtmlOptions {
    /** Dinghy's number for this user. Lets ":::reply" blocks open Messages to it. Omit and they show as plain text. */
    replyLine?: string
    ogImage?: string
    description?: string
    /** Relative link to a downloadable copy (e.g. the PDF next to the page). */
    download?: { href: string; label: string }
}

// "> Pick: Hotel X" (or "> **Pick:** ...") leads the page as a highlighted verdict card.
const PICK = /^\*{0,2}(?:top )?pick\s*:\s*\*{0,2}\s*/i

/** Tables get a data-label on every cell so phones can stack each row into a card. */
export function renderTable(t: Tokens.Table): string {
    const heads = t.header.map((h) => h.text)
    const head = `<tr>${t.header.map((h) => `<th>${safe.parseInline(h.text)}</th>`).join('')}</tr>`
    const rows = t.rows
        .map((r) => `<tr>${r.map((c, i) => `<td data-label="${esc(heads[i] ?? '')}">${safe.parseInline(c.text)}</td>`).join('')}</tr>`)
        .join('')
    return `<table class="tbl"><thead>${head}</thead><tbody>${rows}</tbody></table>`
}

export function renderHtml(doc: DinghyDoc, opts: HtmlOptions = {}): string {
    const body: string[] = []
    for (const seg of splitBlocks(doc.body)) {
      if (seg.kind === 'block') { body.push(renderBlock(seg.name, seg.lines, opts)); continue }
      for (const t of marked.lexer(seg.text)) {
        if (t.type === 'heading') {
            const h = t as Tokens.Heading
            body.push(h.depth <= 2 ? `<section class="sec"><h2>${safe.parseInline(h.text)}</h2></section>` : `<h3${DAY_HEAD.test(h.text.trim()) ? ' class="day"' : ''}>${safe.parseInline(h.text)}</h3>`)
        } else if (t.type === 'list') {
            const l = t as Tokens.List
            const items = l.items.map((it) => {
                if (it.task) return `<li class="chk"><label><input type="checkbox"${it.checked ? ' checked' : ''}> <span>${safe.parseInline(it.text)}</span></label></li>`
                const tr = splitTimeRow(it.text)
                return tr
                    ? `<div class="row"><span class="t">${esc(tr.time)}</span><span>${safe.parseInline(tr.rest)}</span></div>`
                    : `<li>${safe.parseInline(it.text)}</li>`
            })
            const allRows = items.every((i) => i.startsWith('<div'))
            const isChecklist = l.items.length > 0 && l.items.every((it) => it.task)
            body.push(isChecklist ? `<ul class="checklist">${items.join('')}</ul>` : allRows ? `<div class="rows">${items.join('')}</div>` : `<${l.ordered ? 'ol' : 'ul'}>${items.join('')}</${l.ordered ? 'ol' : 'ul'}>`)
        } else if (t.type === 'hr') body.push('<hr>')
        else if (t.type === 'space') continue
        else if (t.type === 'table') body.push(renderTable(t as Tokens.Table))
        else if (t.type === 'blockquote' && PICK.test((t as Tokens.Blockquote).text.trim())) {
            const q = t as Tokens.Blockquote
            body.push(`<aside class="pick"><span class="pick-label">top pick</span>${safe.parse(q.text.trim().replace(PICK, ''), { async: false }) as string}</aside>`)
        } else body.push(safe.parser([t]))
      }
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
<meta name="robots" content="noindex"><meta name="theme-color" content="${BRAND.paper}" media="(prefers-color-scheme: light)"><meta name="theme-color" content="#0C1528" media="(prefers-color-scheme: dark)"><meta name="color-scheme" content="light dark">
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
.pick{margin:22px 0;padding:18px 22px;border-radius:18px;background:var(--sand);border-left:4px solid var(--accent);color:var(--ink);font-size:18px}.pick p{margin:6px 0 0}.pick-label{display:block;font:500 10px/1 'DM Mono',monospace;letter-spacing:.16em;text-transform:uppercase;color:var(--accent)}
blockquote{margin:20px 0;padding:14px 18px;border-radius:16px;background:var(--sand);color:var(--ink);font:italic 400 19px/1.45 Fraunces,Georgia,serif}blockquote p{margin:0}
.facts{display:flex;flex-wrap:wrap;gap:8px;margin:18px 0}.fact{flex:1 1 130px;padding:10px 14px;border:1px solid var(--line);border-radius:14px;background:var(--paper)}.fk{display:block;font:500 10px/1.6 'DM Mono',monospace;letter-spacing:.12em;text-transform:uppercase;color:var(--mute)}.fv{display:block;color:var(--ink);font-weight:600;font-size:16px}
.cost{margin:18px 0;padding:6px 18px;border:1px solid var(--line);border-radius:16px}.crow{display:flex;justify-content:space-between;gap:12px;padding:9px 0;border-bottom:1px solid var(--line)}.crow:last-child{border-bottom:0}.crow span:first-child{white-space:nowrap}.crow span:last-child{text-align:right}.ctotal{font-weight:600;color:var(--ink);font-size:18px}.cnote{margin:6px 0 10px;font-size:13px;color:var(--accent)}
.heads{margin:22px 0;padding:14px 18px;border-radius:16px;background:#fff1e8;border-left:4px solid var(--ink);color:var(--ink)}.heads p{margin:6px 0 0}.heads-label{display:block;font:500 10px/1 'DM Mono',monospace;letter-spacing:.16em;text-transform:uppercase;color:var(--ink)}
.place{margin:16px 0;padding:14px 18px;border:1px solid var(--line);border-radius:16px}.pn{font:600 17px/1.3 Schibsted,sans-serif;color:var(--ink)}.pm{font-size:14px;color:var(--body)}.pa{display:flex;gap:10px;margin-top:10px}.pa a{text-decoration:none;border:1px solid var(--line);border-radius:999px;padding:7px 16px;font:500 11px/1 'DM Mono',monospace;letter-spacing:.12em;text-transform:uppercase}
.checklist{list-style:none;padding:0}.checklist li{margin:0;padding:8px 0;border-bottom:1px solid var(--line)}.checklist label{display:flex;gap:12px;align-items:flex-start;cursor:pointer}.checklist input{width:22px;height:22px;margin:1px 0 0;accent-color:var(--accent)}.checklist input:checked+span{text-decoration:line-through;color:var(--mute)}
h3.day{margin:30px 0 4px;padding-top:14px;border-top:1px solid var(--line);font:500 11px/1 'DM Mono',monospace;letter-spacing:.16em;text-transform:uppercase;color:var(--accent)}
.replies{margin:22px 0;display:grid;gap:10px}.reply-hint{margin:0;font:500 10px/1 'DM Mono',monospace;letter-spacing:.16em;text-transform:uppercase;color:var(--mute)}
.reply{display:flex;align-items:center;gap:14px;padding:14px 18px;border-radius:999px;background:var(--ink);color:var(--paper);text-decoration:none;min-height:52px}.reply-k{font:500 10px/1 'DM Mono',monospace;letter-spacing:.16em;text-transform:uppercase;color:#F7C196}.reply-t{font-weight:600;font-size:16px;line-height:1.3}
.reply-off{background:var(--sand);color:var(--ink)}.reply-off .reply-k{color:var(--accent)}
.plcs{display:grid;gap:12px;margin:18px 0}.plc{padding:16px 18px;border:1px solid var(--line);border-radius:18px;background:var(--paper)}.plc-top{display:flex;justify-content:space-between;align-items:baseline;gap:12px}.plc-name{font:500 21px/1.2 Fraunces,Georgia,serif;color:var(--ink)}.plc-dist{font:500 13px/1 'DM Mono',monospace;color:var(--ink);background:var(--sand);padding:6px 10px;border-radius:999px;white-space:nowrap}.plc-badge{display:inline-block;margin:10px 0 6px;font:500 11px/1 'DM Mono',monospace;letter-spacing:.08em;text-transform:uppercase;padding:6px 10px;border-radius:999px;background:var(--sand);color:var(--ink)}.plc-open{background:#e3f1e6;color:#1f5a2e}.plc-closed{background:#f6e3df;color:#7a2a1d}.plc-hours{font-size:13px;opacity:.8}
.opts{display:grid;gap:12px;margin:18px 0}.opt{padding:16px 18px;border:1px solid var(--line);border-radius:18px;background:var(--paper)}.opt-top{display:flex;justify-content:space-between;align-items:baseline;gap:12px}.opt-name{font:500 21px/1.2 Fraunces,Georgia,serif;color:var(--ink)}.opt-price{font:500 13px/1 'DM Mono',monospace;color:var(--ink);background:var(--sand);padding:6px 10px;border-radius:999px;white-space:nowrap}.opt-why{margin:8px 0 0;color:var(--body)}.opt-catch{margin:8px 0 0;font-size:14px;color:var(--ink)}.opt-catch span{margin-right:8px;font:500 10px/1 'DM Mono',monospace;letter-spacing:.14em;text-transform:uppercase;color:var(--accent)}
.sources{margin:26px 0 0;padding-top:16px;border-top:1px solid var(--line)}.src-label{display:block;font:500 10px/1 'DM Mono',monospace;letter-spacing:.16em;text-transform:uppercase;color:var(--mute)}.sources ol{margin:10px 0 0;padding-left:20px;font-size:15px}.src-meta{display:block;font:500 11px/1.5 'DM Mono',monospace;color:var(--mute)}
code{font:14px 'DM Mono',monospace;background:var(--sand);padding:1px 6px;border-radius:6px}
hr{border:0;border-top:1px solid var(--line);margin:32px 0}
.dl{margin:14px 0 0;font:500 11px/1 'DM Mono',monospace;letter-spacing:.14em;text-transform:uppercase}.dl a{text-decoration:none;border:1px solid var(--line);border-radius:999px;padding:8px 14px;display:inline-block}
.foot{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;max-width:720px;margin:0 auto;padding:36px 24px 44px;font:500 10px 'DM Mono',monospace;letter-spacing:.16em;text-transform:uppercase;color:var(--mute)}.foot a{color:inherit;text-decoration:none}
@media (max-width:600px){table.tbl,table.tbl tbody,table.tbl tr,table.tbl td{display:block;width:100%}table.tbl thead{display:none}table.tbl tr{margin:12px 0;padding:6px 14px;border:1px solid var(--line);border-radius:16px}table.tbl td{border:0;padding:6px 0}table.tbl td::before{content:attr(data-label);display:block;font:500 10px/1.6 'DM Mono',monospace;letter-spacing:.12em;text-transform:uppercase;color:var(--mute)}table.tbl td:first-child{font:500 19px/1.3 Fraunces,Georgia,serif;color:var(--ink)}table.tbl td:first-child::before{display:none}.band{height:220px}.card{margin-top:-52px;padding:28px 22px 26px}h1{font-size:36px}h2{font-size:24px}body{font-size:16px}.row{grid-template-columns:84px 1fr}}
/* design layer: scale, rhythm, motion, dark mode */
:root{--r:20px;--gap:24px;--ease:cubic-bezier(.22,.8,.24,1);--warn:#FFF1E8;--shadow:0 1px 2px rgba(14,26,51,.05),0 10px 30px -12px rgba(14,26,51,.18)}
body{font-size:17px;line-height:1.65;text-rendering:optimizeLegibility}
.brand svg{stroke:var(--ink)}
.card{box-shadow:0 2px 4px rgba(14,26,51,.04),0 30px 70px -20px rgba(14,26,51,.28);padding:48px 52px 44px}
.brand{justify-content:space-between}
h1{font-size:clamp(36px,7.2vw,58px);line-height:1;letter-spacing:-.028em;margin:22px 0 14px;text-wrap:balance}
h1::after{content:'';display:block;width:56px;height:3px;border-radius:3px;background:linear-gradient(90deg,var(--accent),#F79E75);margin-top:20px}
.sub{font-size:19px;line-height:1.5;color:var(--mute);max-width:34em;margin:0}
.sec{margin-top:56px;padding-top:0;border-top:0;counter-increment:sec}
.sec h2{display:flex;align-items:baseline;gap:14px;font-size:clamp(25px,5vw,32px);letter-spacing:-.02em}
.sec h2::before{content:counter(sec,decimal-leading-zero);font:500 11px/1 'DM Mono',monospace;letter-spacing:.14em;color:var(--accent);transform:translateY(-.35em)}
main.card{counter-reset:sec}
p{max-width:38em}
.pick,.facts,.opts,.plcs,.cost,.heads,.place,.sources,.replies,.rows,table.tbl{margin-block:var(--gap)}
.pick{background:linear-gradient(135deg,var(--sand),var(--paper));border:1px solid var(--line);border-left:4px solid var(--accent);border-radius:var(--r);padding:22px 26px;box-shadow:var(--shadow)}
.pick p{font:italic 400 22px/1.4 Fraunces,Georgia,serif;margin:10px 0 0}
.fact,.opt,.cost,.place{border-radius:var(--r);transition:transform .25s var(--ease),box-shadow .25s var(--ease),border-color .25s var(--ease)}
.fact{background:linear-gradient(180deg,var(--paper),var(--sand))}
.opt{box-shadow:var(--shadow)}
.opt-name{font-size:22px;letter-spacing:-.01em}
@media (hover:hover){.opt:hover,.place:hover{transform:translateY(-2px);border-color:var(--accent)}}
.heads{background:var(--warn);border-radius:var(--r);border-left-color:var(--accent)}
.reply{transition:transform .18s var(--ease),filter .18s var(--ease);box-shadow:var(--shadow)}
.reply:active{transform:scale(.98)}.reply:hover{filter:brightness(1.12)}
a:focus-visible,.reply:focus-visible,.checklist input:focus-visible{outline:3px solid var(--accent);outline-offset:3px}
.checklist input{transition:transform .15s var(--ease)}.checklist input:active{transform:scale(.88)}
.foot{padding-bottom:max(44px,env(safe-area-inset-bottom))}
@keyframes rise{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}
@keyframes dawn{from{transform:scale(1.08);opacity:.6}to{transform:none;opacity:1}}
.band svg{animation:dawn 1.6s var(--ease) both}
.card>*{animation:rise .7s var(--ease) both}
.card>*:nth-child(2){animation-delay:.05s}.card>*:nth-child(3){animation-delay:.1s}.card>*:nth-child(4){animation-delay:.15s}.card>*:nth-child(5){animation-delay:.2s}.card>*:nth-child(6){animation-delay:.25s}.card>*:nth-child(n+7){animation-delay:.3s}
@media (prefers-reduced-motion:reduce){.band svg,.card>*{animation:none}.opt,.place,.reply,.fact{transition:none}}
@media (max-width:600px){.card{padding:30px 22px 28px;border-radius:22px}.sec{margin-top:44px}.pick p{font-size:20px}.sub{font-size:17px}.reply{min-height:56px}}
@media (prefers-color-scheme:dark){
:root{--paper:#0C1528;--sand:#15213B;--ink:#F7EFE2;--body:rgba(247,239,226,.84);--mute:rgba(247,239,226,.58);--line:rgba(247,239,226,.14);--accent:#F28F6B;--warn:#2B2030;--shadow:0 1px 2px rgba(0,0,0,.4),0 12px 30px -12px rgba(0,0,0,.6)}
body{background:#080F1E}
.card{box-shadow:0 30px 80px -20px rgba(0,0,0,.7)}
.band svg{filter:saturate(.85) brightness(.82)}
.reply{background:var(--accent);color:#0C1528}.reply-k{color:#0C1528;opacity:.7}.reply-off{background:var(--sand);color:var(--ink)}.reply-off .reply-k{color:var(--accent);opacity:1}
th{background:var(--sand);color:var(--ink)}
.dl a{color:var(--ink)}
}
@media print{.band{display:none}.card{margin:0;box-shadow:none;width:100%;max-width:none}.card>*,.band svg{animation:none}.reply,.pa,.dl{display:none}}
</style></head>
<body>
<div class="band" aria-hidden="true">${sunriseSvg({ id: 'f', sunX: 900, boatX: 300, horizon: 330 })}</div>
<main class="card">
<div class="brand">${anchorSvg(BRAND.ink, 18)}<span>dinghy</span></div>
<h1>${esc(doc.title)}</h1>
${doc.subtitle ? `<p class="sub">${esc(doc.subtitle)}</p>` : ''}
${opts.download ? `<p class="dl"><a href="${esc(opts.download.href)}" download>${esc(opts.download.label)}</a></p>` : ''}
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
        const pdf = new PDFDocument({
            // Our own font as the default: pdfkit otherwise loads its built-in
            // Helvetica, whose data files are missing from serverless bundles.
            font: Buffer.from(schibsted400, 'base64') as unknown as string,
            bufferPages: true, size: 'LETTER', margins: { top: 64, bottom: 64, left: 64, right: 64 }, info: { Title: doc.title, Creator: 'Dinghy' } })
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
