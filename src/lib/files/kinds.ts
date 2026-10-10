/**
 * Designed blocks for the page kinds people ask for most: weather, sports,
 * movies/books/games, trips and stays, and the news briefing. Same contract as
 * the other blocks in render.ts: the model writes plain pipe-separated lines,
 * this file turns them into markup. Everything is escaped, links are plain
 * http(s), and the only image allowed is one the page builder already copied
 * next to the page (img/<name>.jpg|png|webp). Remote image URLs never reach
 * the HTML, so a page cannot pull from a third-party server when it opens.
 */

export const KIND_BLOCKS = ['weather', 'scores', 'media', 'stay', 'route', 'briefing', 'gallery'] as const
export type KindBlock = (typeof KIND_BLOCKS)[number]

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
export const cells = (line: string): string[] => line.split('|').map((c) => c.trim())
const httpUrl = (u?: string) => (u && /^https?:\/\/[^\s\u0000-\u001f]+$/i.test(u) ? u : '')
const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, '') } catch { return '' } }

/** Local copy of a photo, written by the page builder. Anything else is dropped. */
export const LOCAL_IMG = /^img\/[a-z0-9][a-z0-9-]{0,60}\.(?:jpg|jpeg|png|webp)$/i
const img = (p?: string) => (p && LOCAL_IMG.test(p) ? p : '')

/** Stable 0-359 hue from a title, so a card with no photo still gets its own colour. */
export function hue(s: string): number {
    let h = 0
    for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) % 360
    return h
}


const CLOUD = '<path d="M17 38a9 9 0 0 1 1.6-17.9A12 12 0 0 1 41.4 22 8 8 0 0 1 41 38z" fill="#fff"/>'
const SUN = (x: number, y: number, r: number) => `<g transform="translate(${x} ${y})"><circle r="${r}" fill="#FFD27A"/>${[0, 45, 90, 135, 180, 225, 270, 315].map((a) => `<path d="M0 ${-r - 4}V${-r - 9}" stroke="#FFD27A" stroke-width="3" stroke-linecap="round" transform="rotate(${a})"/>`).join('')}</g>`
/** Small inline weather icon. No emoji, so it looks the same on every phone. */
export function skyIcon(cls: string, size: number): string {
    const body: Record<string, string> = {
        clear: SUN(32, 32, 11),
        part: `${SUN(40, 22, 8)}<g transform="translate(-4 8)">${CLOUD}</g>`,
        cloud: `<g transform="translate(0 4)">${CLOUD}</g>`,
        rain: `${CLOUD}${[22, 31, 40].map((x) => `<path d="M${x} 43l-3 8" stroke="#BFD6FF" stroke-width="3" stroke-linecap="round"/>`).join('')}`,
        storm: `${CLOUD}<path d="M33 38l-6 9h5l-3 8 9-11h-5l3-6z" fill="#FFD27A"/>`,
        snow: `${CLOUD}${[22, 32, 42].map((x) => `<circle cx="${x}" cy="47" r="2.4" fill="#fff"/>`).join('')}`,
        fog: `${CLOUD}${[44, 51].map((y) => `<path d="M14 ${y}h36" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity=".7"/>`).join('')}`,
    }
    return `<svg viewBox="0 0 64 64" width="${size}" height="${size}" aria-hidden="true">${body[cls] ?? body.part}</svg>`
}

/** Pick a sky look from the words the model used. */
export function skyOf(sky: string): { cls: string } {
    const s = sky.toLowerCase()
    if (/thunder|storm/.test(s)) return { cls: 'storm' }
    if (/snow|sleet|flurr/.test(s)) return { cls: 'snow' }
    if (/rain|shower|drizzle/.test(s)) return { cls: 'rain' }
    if (/fog|mist|haze/.test(s)) return { cls: 'fog' }
    if (/part|mostly sunny|scatter/.test(s)) return { cls: 'part' }
    if (/cloud|overcast/.test(s)) return { cls: 'cloud' }
    if (/clear|sun|fair/.test(s)) return { cls: 'clear' }
    return { cls: 'part' }
}

export const num = (s?: string): number | null => {
    const m = (s ?? '').match(/-?\d+(?:\.\d+)?/)
    return m ? Number(m[0]) : null
}

/**
 * weather: first line "Place | now temp | sky | high | low | wind | rain chance | feels like",
 * then one "Day | high | low | sky | rain chance" line per forecast day.
 */
function renderWeather(lines: string[]): string {
    const [place, now, sky, hi, lo, wind, rain, feels] = cells(lines[0] ?? '')
    if (!place) return ''
    const s = skyOf(sky ?? '')
    const days = lines.slice(1, 9).map(cells).filter((d) => d[0])
    const lows = days.map((d) => num(d[2])).filter((n): n is number => n !== null)
    const highs = days.map((d) => num(d[1])).filter((n): n is number => n !== null)
    const min = Math.min(...lows, ...(num(lo) !== null ? [num(lo) as number] : []))
    const max = Math.max(...highs, ...(num(hi) !== null ? [num(hi) as number] : []))
    const span = Number.isFinite(min) && Number.isFinite(max) && max > min ? max - min : 0
    const bar = (l: number | null, h: number | null) => {
        if (!span || l === null || h === null) return ''
        const a = Math.max(0, Math.min(100, ((l - min) / span) * 100))
        const b = Math.max(a + 6, Math.min(100, ((h - min) / span) * 100))
        return `<span class="wx-bar" aria-hidden="true"><i style="left:${a.toFixed(0)}%;width:${(b - a).toFixed(0)}%"></i></span>`
    }
    const facts = [
        hi || lo ? ['High / low', `${esc(hi ?? '')} / ${esc(lo ?? '')}`] : null,
        wind ? ['Wind', esc(wind)] : null,
        rain ? ['Rain', esc(rain)] : null,
        feels ? ['Feels like', esc(feels)] : null,
    ].filter((x): x is string[] => !!x)
    const rows = days.map((d) => {
        const ds = skyOf(d[3] ?? '')
        return `<div class="wx-day"><span class="wx-dn">${esc(d[0])}</span><span class="wx-dg" title="${esc(d[3] ?? '')}">${skyIcon(ds.cls, 26)}</span><span class="wx-dl">${esc(d[2] ?? '')}</span>${bar(num(d[2]), num(d[1]))}<span class="wx-dh">${esc(d[1] ?? '')}</span><span class="wx-dr">${esc(d[4] ?? '')}</span></div>`
    })
    return `<div class="wx wx-${s.cls}"><div class="wx-hero"><div><div class="wx-place">${esc(place)}</div><div class="wx-now">${esc(now ?? '')}</div><div class="wx-sky">${esc(sky ?? '')}</div></div><div class="wx-glyph" aria-hidden="true">${skyIcon(s.cls, 88)}</div></div>${facts.length ? `<div class="wx-facts">${facts.map(([k, v]) => `<div><span>${k}</span>${v}</div>`).join('')}</div>` : ''}${rows.length ? `<div class="wx-days">${rows.join('')}</div>` : ''}</div>`
}

/**
 * scores: "Away team | away score | Home team | home score | status | detail".
 * Status is "Final", "Live" or a start time; the higher score is bold once final or live.
 */
function renderScores(lines: string[]): string {
    const cards = lines.slice(0, 10).map((l) => {
        const [a, as, h, hs, status, detail] = cells(l)
        if (!a || !h) return ''
        const an = num(as), hn = num(hs)
        const played = an !== null && hn !== null
        const live = /live|q\d|inning|half|period|'/i.test(status ?? '') && !/final/i.test(status ?? '')
        const win = played ? (an! > hn! ? 'a' : hn! > an! ? 'h' : '') : ''
        const row = (side: 'a' | 'h', name: string, score?: string) =>
            `<div class="sc-row${win === side ? ' sc-win' : ''}"><span class="sc-mark" style="--h:${hue(name)}">${esc(name.replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase())}</span><span class="sc-name">${esc(name)}</span><span class="sc-n">${played ? esc(score ?? '') : ''}</span></div>`
        return `<div class="sc${live ? ' sc-live' : ''}"><div class="sc-st">${live ? '<i></i>' : ''}${esc(status ?? '')}</div>${row('a', a, as)}${row('h', h, hs)}${detail ? `<div class="sc-d">${esc(detail)}</div>` : ''}</div>`
    })
    return `<div class="scs">${cards.join('')}</div>`
}

/** media: "Title | movie/book/game | year | rating | by/with | why it is worth it | photo | link". */
function renderMedia(lines: string[]): string {
    const cards = lines.slice(0, 8).map((l) => {
        const [title, kind, year, rating, by, why, photo, link] = cells(l)
        if (!title) return ''
        const k = /book|game/i.test(kind ?? '') ? (kind as string).toLowerCase() : 'movie'
        const p = img(photo)
        const url = httpUrl(link)
        const cover = p
            ? `<div class="md-cover"><img src="${esc(p)}" alt="${esc(title)} cover" loading="lazy" decoding="async"></div>`
            : `<div class="md-cover md-blank" style="--h:${hue(title)}"><span>${esc(title.slice(0, 40))}</span><em>${esc(k)}</em></div>`
        const meta = [year, by].filter(Boolean).map((t) => esc(t as string)).join(' · ')
        return `<article class="md">${cover}<div class="md-b"><div class="md-top"><h4>${esc(title)}</h4>${rating ? `<span class="md-r">${esc(rating)}</span>` : ''}</div>${meta ? `<div class="md-m">${meta}</div>` : ''}${why ? `<p>${esc(why)}</p>` : ''}${url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(host(url))}</a>` : ''}</div></article>`
    })
    return `<div class="mds">${cards.join('')}</div>`
}

/** stay: "Hotel | price per night | rating | area or distance | the catch | photo | link". */
function renderStay(lines: string[]): string {
    const cards = lines.slice(0, 6).map((l) => {
        const [name, price, rating, area, catchTxt, photo, link] = cells(l)
        if (!name) return ''
        const p = img(photo)
        const url = httpUrl(link)
        const pic = p ? `<div class="st-pic"><img src="${esc(p)}" alt="${esc(name)}" loading="lazy" decoding="async"></div>` : `<div class="st-pic st-blank" style="--h:${hue(name)}" aria-hidden="true"></div>`
        return `<article class="st">${pic}<div class="st-b"><div class="st-top"><h4>${esc(name)}</h4>${price ? `<span class="st-p">${esc(price)}</span>` : ''}</div><div class="st-m">${[rating && `★ ${esc(rating)}`, area && esc(area)].filter(Boolean).join(' · ')}</div>${catchTxt ? `<p class="st-c"><span>Catch</span>${esc(catchTxt)}</p>` : ''}${url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(host(url))}</a>` : ''}</div></article>`
    })
    return `<div class="sts">${cards.join('')}</div>`
}

/** route: "From | To | mode | time | detail" per leg. Draws a vertical line with stops. */
function renderRoute(lines: string[]): string {
    const legs = lines.slice(0, 10).map(cells).filter((c) => c[0] && c[1])
    if (!legs.length) return ''
    const out: string[] = []
    let last = ''
    const stop = (name: string) => {
        if (name === last) return
        last = name
        out.push(`<div class="rt-stop"><span class="rt-dot"></span><span class="rt-name">${esc(name)}</span></div>`)
    }
    for (const leg of legs) {
        stop(leg[0])
        out.push(`<div class="rt-leg"><span class="rt-mode">${esc(leg[2] ?? '')}</span>${leg[3] ? `<span class="rt-time">${esc(leg[3])}</span>` : ''}${leg[4] ? `<span class="rt-det">${esc(leg[4])}</span>` : ''}</div>`)
        stop(leg[1])
    }
    return `<div class="rt">${out.join('')}</div>`
}

/** briefing: "Headline | source | when | one-line summary | https://link". */
function renderBriefing(lines: string[]): string {
    const items = lines.slice(0, 10).map((l, i) => {
        const [head, source, when, sum, link] = cells(l)
        if (!head) return ''
        const url = httpUrl(link)
        const title = url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(head)}</a>` : esc(head)
        return `<article class="br"><span class="br-n">${String(i + 1).padStart(2, '0')}</span><div><h4>${title}</h4>${sum ? `<p>${esc(sum)}</p>` : ''}<div class="br-m">${[source && esc(source), when && esc(when), url && host(url)].filter(Boolean).join(' · ')}</div></div></article>`
    })
    return `<div class="brs">${items.join('')}</div>`
}

/** gallery: "img/name.jpg | caption | credit | license". Only builder-copied images render. */
function renderGallery(lines: string[]): string {
    const figs = lines.slice(0, 6).map((l) => {
        const [src, caption, credit, license] = cells(l)
        const p = img(src)
        if (!p) return ''
        const cr = [credit, license].filter(Boolean).map((t) => esc(t as string)).join(' · ')
        return `<figure><img src="${esc(p)}" alt="${esc(caption ?? '')}" loading="lazy" decoding="async"><figcaption>${esc(caption ?? '')}${cr ? `<small>${cr}</small>` : ''}</figcaption></figure>`
    }).filter(Boolean)
    if (!figs.length) return ''
    return `<div class="gal gal-${Math.min(figs.length, 3)}">${figs.join('')}</div>`
}

export function renderKind(name: KindBlock, lines: string[]): string {
    switch (name) {
        case 'weather': return renderWeather(lines)
        case 'scores': return renderScores(lines)
        case 'media': return renderMedia(lines)
        case 'stay': return renderStay(lines)
        case 'route': return renderRoute(lines)
        case 'briefing': return renderBriefing(lines)
        case 'gallery': return renderGallery(lines)
    }
}

/** Light styles use the page tokens (--paper, --sand, --ink, --accent); dark mode flips the tokens, so only fixed colours are overridden below. */
export const KINDS_CSS = `
.wx,.scs,.mds,.sts,.rt,.brs,.gal{margin-block:var(--gap,24px)}
.wx{border-radius:var(--r,20px);overflow:hidden;border:1px solid var(--line);box-shadow:var(--shadow);background:var(--paper)}
.wx-hero{display:flex;justify-content:space-between;align-items:center;padding:26px 28px;color:#fff;background:linear-gradient(160deg,#3B5BA8,#7FA3DC)}
.wx-clear .wx-hero{background:linear-gradient(160deg,#2F6FC4,#F2B56B)}.wx-part .wx-hero{background:linear-gradient(160deg,#3F6AB5,#9DB8DF)}
.wx-cloud .wx-hero{background:linear-gradient(160deg,#5E6B85,#A3AEC2)}.wx-rain .wx-hero{background:linear-gradient(160deg,#34476B,#6D87AE)}
.wx-storm .wx-hero{background:linear-gradient(160deg,#241F3D,#5B4F86)}.wx-snow .wx-hero{background:linear-gradient(160deg,#6F89B3,#C9D8EC)}.wx-fog .wx-hero{background:linear-gradient(160deg,#69758A,#BCC5D2)}
.wx-place{font:500 11px/1 'DM Mono',monospace;letter-spacing:.16em;text-transform:uppercase;opacity:.9}
.wx-now{font:500 72px/1 Fraunces,Georgia,serif;letter-spacing:-.03em;margin:12px 0 6px}.wx-sky{font-size:18px}
.wx-glyph{line-height:0;filter:drop-shadow(0 6px 14px rgba(0,0,0,.25))}
.wx-facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(78px,1fr));border-bottom:1px solid var(--line)}
.wx-facts div{padding:14px 18px;color:var(--ink);font-weight:600;border-right:1px solid var(--line)}.wx-facts div:last-child{border-right:0}
.wx-facts span{display:block;font:500 10px/1.6 'DM Mono',monospace;letter-spacing:.12em;text-transform:uppercase;color:var(--mute);font-weight:400}
.wx-dg{line-height:0;filter:drop-shadow(0 1px 2px rgba(14,26,51,.35))}
.wx-dg path[fill="#fff"]{fill:#A9B7D0}
.wx-day{display:grid;grid-template-columns:54px 30px 38px 1fr 38px 52px;gap:8px;align-items:center;padding:11px 18px;border-bottom:1px solid var(--line);color:var(--ink);font-size:15px}.wx-day:last-child{border-bottom:0}
.wx-dn{font:500 12px 'DM Mono',monospace;letter-spacing:.08em;text-transform:uppercase;color:var(--accent)}.wx-dl{color:var(--mute);text-align:right}.wx-dh{font-weight:600}.wx-dr{font-size:13px;color:var(--mute);text-align:right}
.wx-bar{position:relative;height:6px;border-radius:6px;background:var(--sand)}.wx-bar i{position:absolute;top:0;bottom:0;border-radius:6px;background:linear-gradient(90deg,#6D9BD8,#F28F6B)}
.scs{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px}
.sc{border:1px solid var(--line);border-radius:var(--r,20px);padding:14px 18px;background:var(--paper);box-shadow:var(--shadow)}
.sc-st{display:flex;align-items:center;gap:8px;font:500 10px/1 'DM Mono',monospace;letter-spacing:.14em;text-transform:uppercase;color:var(--mute);margin-bottom:8px}
.sc-live .sc-st{color:var(--accent)}.sc-st i{width:8px;height:8px;border-radius:50%;background:var(--accent);animation:pulse 1.6s ease-in-out infinite}
.sc-row{display:flex;align-items:center;gap:12px;padding:6px 0;color:var(--body)}.sc-win{color:var(--ink);font-weight:600}
.sc-mark{width:34px;height:34px;border-radius:50%;display:grid;place-items:center;font:500 10px/1 'DM Mono',monospace;color:#fff;background:hsl(var(--h) 45% 38%)}
.sc-name{flex:1}.sc-n{font:500 26px/1 Fraunces,Georgia,serif;color:var(--ink)}.sc-d{margin-top:8px;padding-top:8px;border-top:1px solid var(--line);font-size:13px;color:var(--mute)}
@keyframes pulse{50%{opacity:.3}}
.mds{display:grid;gap:14px}
.md,.st{display:grid;grid-template-columns:112px 1fr;gap:16px;border:1px solid var(--line);border-radius:var(--r,20px);overflow:hidden;background:var(--paper);box-shadow:var(--shadow)}
.md-cover,.st-pic{position:relative;min-height:156px;background:var(--sand)}.md-cover img,.st-pic img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.md-blank,.st-blank{display:flex;flex-direction:column;justify-content:flex-end;padding:12px;color:#fff;background:linear-gradient(155deg,hsl(var(--h) 26% 28%),hsl(calc(var(--h) + 30) 30% 42%))}
.md-blank span{font:500 17px/1.15 Fraunces,Georgia,serif}.md-blank em{font:500 9px/1 'DM Mono',monospace;letter-spacing:.16em;text-transform:uppercase;margin-top:8px;opacity:.85;font-style:normal}
.md-b,.st-b{padding:14px 18px 14px 0}.md-top,.st-top{display:flex;justify-content:space-between;align-items:baseline;gap:12px}
h4{margin:0;font:500 21px/1.2 Fraunces,Georgia,serif;letter-spacing:-.01em;color:var(--ink)}
.md-r,.st-p{font:500 14px 'DM Mono',monospace;color:var(--accent);white-space:nowrap}.md-m,.st-m{font-size:13px;color:var(--mute);margin:4px 0}
.md-b p,.st-c{margin:8px 0;font-size:15px;color:var(--body)}.st-c span{display:inline-block;margin-right:8px;font:500 10px/1 'DM Mono',monospace;letter-spacing:.14em;text-transform:uppercase;color:var(--accent)}
.md-b a,.st-b a,.br a{font-size:13px}
.st{grid-template-columns:150px 1fr}.st-blank{display:none}.st:has(.st-blank){grid-template-columns:1fr;border-left:4px solid var(--accent)}.st:has(.st-blank) .st-b{padding:14px 18px}
.sts{display:grid;gap:14px}
.rt{position:relative;padding-left:22px;border-left:2px solid var(--line);margin-left:7px}
.rt-stop{position:relative;padding:4px 0}.rt-dot{position:absolute;left:-30px;top:10px;width:14px;height:14px;border-radius:50%;background:var(--paper);border:3px solid var(--accent)}
.rt-name{font:600 17px/1.3 Schibsted,sans-serif;color:var(--ink)}
.rt-leg{display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center;margin:2px 0 14px;font-size:14px;color:var(--mute)}.rt-mode{padding:3px 10px;border-radius:999px;background:var(--sand);color:var(--ink);font:500 11px 'DM Mono',monospace;letter-spacing:.08em;text-transform:uppercase}.rt-time{color:var(--ink);font-weight:600}
.brs{display:grid;gap:0}.br{display:grid;grid-template-columns:44px 1fr;gap:12px;padding:16px 0;border-bottom:1px solid var(--line)}.br:last-child{border-bottom:0}
.br-n{font:500 13px/1.9 'DM Mono',monospace;color:var(--accent)}.br h4{font-size:20px}.br h4 a{color:var(--ink);text-decoration:none;font-size:inherit}.br h4 a:hover{text-decoration:underline;text-underline-offset:4px}
.br p{margin:6px 0;font-size:15px}.br-m{font:500 11px/1.5 'DM Mono',monospace;letter-spacing:.06em;color:var(--mute);text-transform:uppercase}
.gal{display:grid;gap:10px}.gal-1{grid-template-columns:1fr}.gal-2{grid-template-columns:1fr 1fr}.gal-3{grid-template-columns:2fr 1fr 1fr}
.gal figure{margin:0;position:relative;border-radius:var(--r,20px);overflow:hidden;background:var(--sand);min-height:160px}.gal img{display:block;width:100%;height:100%;min-height:200px;max-height:360px;object-fit:cover}
.gal figcaption{position:absolute;left:0;right:0;bottom:0;padding:26px 14px 10px;color:#fff;font-size:13px;background:linear-gradient(transparent,rgba(8,15,30,.78))}.gal small{display:block;opacity:.75;font-size:10px;margin-top:2px}
@media (max-width:600px){.wx-now{font-size:60px}.wx-hero{padding:22px}.wx-day{grid-template-columns:44px 26px 32px 1fr 32px 0}.wx-dr{display:none}.md{grid-template-columns:92px 1fr}.st{grid-template-columns:1fr}.st-pic{min-height:170px}.st-b{padding:0 16px 14px}.gal-2,.gal-3{grid-template-columns:1fr}}
@media (prefers-color-scheme:dark){.wx-dg path[fill="#fff"]{fill:#fff}.sc,.wx,.md,.st{box-shadow:var(--shadow)}.wx-hero,.md-blank,.st-blank{filter:brightness(.92)}}
@media print{.wx,.sc,.md,.st{box-shadow:none;break-inside:avoid}}
`
