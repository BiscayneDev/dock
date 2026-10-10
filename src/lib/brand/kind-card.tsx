import type { ReactElement } from 'react'
import { ImageResponse } from 'next/og'
import { MARK_PNG } from './card-art'
import { dmMono500, frauncesDisplay, schibsted400, schibsted600 } from './static-fonts'
import { cells, hue, num, skyIcon, skyOf } from '@/lib/files/kinds'
import { splitBlocks } from '@/lib/files/render'

/**
 * Phone-width preview cards for hosted pages, sent into the chat above the
 * link. Weather, scores, stays and routes. Satori draws these (flexbox only), so
 * each kind has its own layout; the data comes from the same pipe lines the
 * page uses. Built from the finished page body only: no network; photos are vetted local copies only.
 */

const W = 1080
const INK = '#0E1A33'
const PAPER = '#FBF6EE'
const SAND = '#F1E8DA'
const CORAL = '#C8583A'
const MUTE = 'rgba(14,26,51,0.58)'

const fontData = (b64: string): ArrayBuffer => {
    const buf = Buffer.from(b64, 'base64')
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
}
const fonts = () => [
    { name: 'Fraunces', data: fontData(frauncesDisplay), weight: 500 as const, style: 'normal' as const },
    { name: 'Schibsted Grotesk', data: fontData(schibsted400), weight: 400 as const, style: 'normal' as const },
    { name: 'Schibsted Grotesk', data: fontData(schibsted600), weight: 600 as const, style: 'normal' as const },
    { name: 'DM Mono', data: fontData(dmMono500), weight: 500 as const, style: 'normal' as const },
]

const SKY: Record<string, [string, string]> = {
    clear: ['#2F6FC4', '#F2B56B'], part: ['#3F6AB5', '#9DB8DF'], cloud: ['#5E6B85', '#A3AEC2'], rain: ['#34476B', '#6D87AE'],
    storm: ['#241F3D', '#5B4F86'], snow: ['#6F89B3', '#C9D8EC'], fog: ['#69758A', '#BCC5D2'],
}
const icon = (cls: string) => `data:image/svg+xml;base64,${Buffer.from(skyIcon(cls, 128).replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ')).toString('base64')}`
/** Latin text only: a glyph the bundled fonts lack makes Satori try a network font download, so strip those. */
const latin = (s: string) => s.replace(/[^\u0000-\u024F\u2010-\u2027\u20AC\u2122]/g, '').replace(/\s+/g, ' ').trim()
const clip = (raw: string, n: number) => { const s = latin(raw); return s.length > n ? `${s.slice(0, n - 1).trimEnd()}...` : s }

/** hsl to hex, because Satori wants plain colours. */
function hsl(h: number, s: number, l: number): string {
    const a = (s / 100) * Math.min(l / 100, 1 - l / 100)
    const f = (n: number) => {
        const k = (n + h / 30) % 12
        const c = l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))
        return Math.round(255 * c).toString(16).padStart(2, '0')
    }
    return `#${f(0)}${f(8)}${f(4)}`
}

const Brand = ({ color = INK }: { color?: string }) => (
    <div style={{ display: 'flex', alignItems: 'center' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={MARK_PNG} width={44} height={44} alt="" style={{ borderRadius: 10 }} />
        <div style={{ display: 'flex', marginLeft: 14, fontFamily: 'DM Mono', fontSize: 18, letterSpacing: '0.16em', textTransform: 'uppercase', color }}>dinghy</div>
    </div>
)
const Foot = () => (
    <div style={{ display: 'flex', marginTop: 'auto', paddingTop: 20, fontFamily: 'DM Mono', fontSize: 16, letterSpacing: '0.16em', textTransform: 'uppercase', color: MUTE }}>
        full page in the link below
    </div>
)

function weatherCard(lines: string[]): { el: ReactElement; h: number } | null {
    const [place, now, sky, hi, lo, wind, rain] = cells(lines[0] ?? '')
    if (!place || !now) return null
    const s = skyOf(sky ?? '')
    const [c1, c2] = SKY[s.cls] ?? SKY.part
    const days = lines.slice(1, 6).map(cells).filter((d) => d[0])
    const lows = days.map((d) => num(d[2])).filter((n): n is number => n !== null)
    const highs = days.map((d) => num(d[1])).filter((n): n is number => n !== null)
    const min = Math.min(...lows, num(lo) ?? 999)
    const max = Math.max(...highs, num(hi) ?? -999)
    const span = max > min && Number.isFinite(min) && Number.isFinite(max) ? max - min : 0
    const chips = [['High / low', `${hi ?? ''} / ${lo ?? ''}`], wind ? ['Wind', wind] : null, rain ? ['Rain', rain] : null].filter((x): x is string[] => !!x)
    const H = 560 + 120 + days.length * 92 + 90
    const el = (
        <div style={{ width: W, height: H, display: 'flex', flexDirection: 'column', background: PAPER }}>
            <div style={{ display: 'flex', flexDirection: 'column', height: 560, padding: '52px 60px', color: '#fff', backgroundImage: `linear-gradient(160deg, ${c1}, ${c2})`, position: 'relative' }}>
                <Brand color="rgba(255,255,255,0.9)" />
                <div style={{ display: 'flex', marginTop: 56, fontFamily: 'DM Mono', fontSize: 24, letterSpacing: '0.16em', textTransform: 'uppercase' }}>{clip(place, 34)}</div>
                <div style={{ display: 'flex', marginTop: 10, fontFamily: 'Fraunces', fontSize: 230, lineHeight: 1, letterSpacing: '-0.03em' }}>{clip(now, 14)}</div>
                <div style={{ display: 'flex', marginTop: 8, fontFamily: 'Schibsted Grotesk', fontSize: 44 }}>{clip(sky ?? '', 30)}</div>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={icon(s.cls)} width={280} height={280} alt="" style={{ position: 'absolute', right: 56, top: 190 }} />
            </div>
            <div style={{ display: 'flex', height: 120, borderBottom: '2px solid rgba(14,26,51,0.12)' }}>
                {chips.map(([k, v], i) => (
                    <div key={k} style={{ display: 'flex', flexDirection: 'column', flex: 1, justifyContent: 'center', padding: '0 40px', borderRight: i < chips.length - 1 ? '2px solid rgba(14,26,51,0.12)' : 'none' }}>
                        <div style={{ display: 'flex', fontFamily: 'DM Mono', fontSize: 16, letterSpacing: '0.12em', textTransform: 'uppercase', color: MUTE }}>{k}</div>
                        <div style={{ display: 'flex', fontFamily: 'Schibsted Grotesk', fontWeight: 600, fontSize: 34, color: INK }}>{clip(v, 16)}</div>
                    </div>
                ))}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', padding: '0 60px' }}>
                {days.map((d) => {
                    const l = num(d[2]), h = num(d[1])
                    const a = span && l !== null ? Math.max(0, Math.min(100, ((l - min) / span) * 100)) : 0
                    const b = span && h !== null ? Math.max(a + 8, Math.min(100, ((h - min) / span) * 100)) : 0
                    return (
                        <div key={d[0]} style={{ display: 'flex', alignItems: 'center', height: 92, borderBottom: '2px solid rgba(14,26,51,0.08)' }}>
                            <div style={{ display: 'flex', width: 110, fontFamily: 'DM Mono', fontSize: 24, letterSpacing: '0.08em', textTransform: 'uppercase', color: CORAL }}>{clip(d[0], 5)}</div>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={icon(skyOf(d[3] ?? '').cls)} width={56} height={56} alt="" style={{ filter: 'none' }} />
                            <div style={{ display: 'flex', width: 90, justifyContent: 'flex-end', fontFamily: 'Schibsted Grotesk', fontSize: 30, color: MUTE }}>{d[2] ?? ''}</div>
                            <div style={{ display: 'flex', flex: 1, height: 12, margin: '0 24px', borderRadius: 12, background: SAND, position: 'relative' }}>
                                {span > 0 && <div style={{ position: 'absolute', top: 0, bottom: 0, left: `${a}%`, width: `${b - a}%`, borderRadius: 12, backgroundImage: 'linear-gradient(90deg, #6D9BD8, #F28F6B)' }} />}
                            </div>
                            <div style={{ display: 'flex', width: 90, fontFamily: 'Schibsted Grotesk', fontWeight: 600, fontSize: 32, color: INK }}>{d[1] ?? ''}</div>
                        </div>
                    )
                })}
            </div>
            <div style={{ display: 'flex', padding: '0 60px', marginTop: 'auto', marginBottom: 28 }}><Foot /></div>
        </div>
    )
    return { el, h: H }
}

function scoresCard(title: string, subtitle: string | undefined, lines: string[]): { el: ReactElement; h: number } | null {
    const games = lines.slice(0, 4).map(cells).filter((g) => g[0] && g[2])
    if (!games.length) return null
    const H = 330 + games.length * 250 + 90
    const badge = (name: string) => (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 64, height: 64, borderRadius: 64, background: hsl(hue(name), 45, 38), color: '#fff', fontFamily: 'DM Mono', fontSize: 18 }}>
            {name.replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase()}
        </div>
    )
    const el = (
        <div style={{ width: W, height: H, display: 'flex', flexDirection: 'column', background: PAPER, padding: '52px 60px 28px' }}>
            <Brand />
            <div style={{ display: 'flex', marginTop: 44, fontFamily: 'Fraunces', fontSize: 76, lineHeight: 1.02, letterSpacing: '-0.02em', color: INK }}>{clip(title, 40)}</div>
            {subtitle && <div style={{ display: 'flex', marginTop: 14, fontFamily: 'Schibsted Grotesk', fontSize: 30, color: MUTE }}>{clip(subtitle, 70)}</div>}
            <div style={{ display: 'flex', flexDirection: 'column', marginTop: 36 }}>
                {games.map((g, i) => {
                    const [a, as, h, hs, status, detail] = g
                    const an = num(as), hn = num(hs)
                    const played = an !== null && hn !== null
                    const win = played ? (an! > hn! ? 'a' : hn! > an! ? 'h' : '') : ''
                    const live = /live|q\d|inning|half|period|'/i.test(status ?? '') && !/final/i.test(status ?? '')
                    const row = (side: 'a' | 'h', name: string, score?: string) => (
                        <div style={{ display: 'flex', alignItems: 'center', height: 76 }}>
                            {badge(name)}
                            <div style={{ display: 'flex', flex: 1, marginLeft: 22, fontFamily: 'Schibsted Grotesk', fontWeight: win === side ? 600 : 400, fontSize: 38, color: win === side ? INK : 'rgba(14,26,51,0.78)' }}>{clip(name, 22)}</div>
                            <div style={{ display: 'flex', fontFamily: 'Fraunces', fontSize: 60, color: INK }}>{played ? score : ''}</div>
                        </div>
                    )
                    return (
                        <div key={i} style={{ display: 'flex', flexDirection: 'column', height: 226, marginBottom: 24, padding: '22px 34px', borderRadius: 32, border: '2px solid rgba(14,26,51,0.12)', background: '#fff' }}>
                            <div style={{ display: 'flex', alignItems: 'center', fontFamily: 'DM Mono', fontSize: 18, letterSpacing: '0.14em', textTransform: 'uppercase', color: live ? CORAL : MUTE }}>{live ? <div style={{ display: 'flex', width: 14, height: 14, borderRadius: 14, background: CORAL, marginRight: 12 }} /> : null}{clip(status ?? '', 28)}</div>
                            {row('a', a, as)}
                            {row('h', h, hs)}
                            {detail ? <div style={{ display: 'none' }}>{detail}</div> : null}
                        </div>
                    )
                })}
            </div>
            <Foot />
        </div>
    )
    return { el, h: H }
}

type CardPhoto = { path: string; bytes: Buffer; contentType: string; credit?: string; license?: string }
const dataUri = (ph: CardPhoto) => `data:${ph.contentType};base64,${ph.bytes.toString('base64')}`

/** Same rule as the page: confirmed only with a source and a date, everything else shows unverified. */
export function checkChips(lines: string[]): { t: string; ok: boolean }[] {
    return lines.slice(0, 3).map(cells).filter((c) => c[0]).map((c) => ({ t: clip(c[0], 34), ok: /^confirmed$/i.test(c[1] ?? '') && !!c[2] && !!c[3] }))
}

function stayCard(segs: ReturnType<typeof splitBlocks>, photos: CardPhoto[]): { el: ReactElement; h: number } | null {
    const stay = segs.find((x) => x.kind === 'block' && x.name === 'stay')
    if (!stay || stay.kind !== 'block') return null
    const rows = stay.lines.map(cells).filter((c) => c[0])
    if (!rows.length) return null
    const get = (n: string) => { const b = segs.find((x) => x.kind === 'block' && x.name === n); return b && b.kind === 'block' ? b.lines : [] }
    const lead: Record<string, string[]> = {}
    for (const l of get('lead')) { const [k, ...v] = cells(l); if (k && !lead[k.toLowerCase()]) lead[k.toLowerCase()] = v }
    const pickName = (lead.pick?.[0] ?? '').toLowerCase()
    const row = rows.find((r) => pickName && r[0].toLowerCase() === pickName) ?? rows[0]
    const [name, price, , area, catchTxt, photoPath] = row
    const photo = photos.find((ph) => ph.path === photoPath && /^image\/(jpeg|png)$/.test(ph.contentType))
    const beat = lead.beat
    const chips = checkChips(get('checks'))
    const [c1, c2] = [hsl(hue(name), 40, 30), hsl((hue(name) + 40) % 360, 45, 50)]
    const creditText = photo?.credit ? `Photo: ${photo.credit}${photo.license ? `, ${photo.license}` : ''}` : ''
    const creditHeight = creditText ? Math.ceil(creditText.length / 70) * 26 + 20 : 0
    const H = 640 + creditHeight + 240 + (chips.length ? 180 : 0) + (beat?.[0] ? 90 : 0) + 90
    const tag = (t: string, fill: string, color: string) => (
        <div style={{ display: 'flex', padding: '14px 24px', borderRadius: 40, background: fill, color, fontFamily: 'DM Mono', fontSize: 22, letterSpacing: '0.14em', textTransform: 'uppercase' }}>{t}</div>
    )
    const el = (
        <div style={{ width: W, height: H, display: 'flex', flexDirection: 'column', background: PAPER }}>
            <div style={{ display: 'flex', position: 'relative', width: W, height: 640, backgroundImage: `linear-gradient(160deg, ${c1}, ${c2})` }}>
                {photo && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={dataUri(photo)} width={W} height={640} alt="" style={{ position: 'absolute', left: 0, top: 0, width: W, height: 640, objectFit: 'cover' }} />
                )}
                <div style={{ display: 'flex', position: 'absolute', left: 0, top: 0, width: W, height: 640, backgroundImage: 'linear-gradient(180deg, rgba(8,15,30,0.3), rgba(8,15,30,0) 35%, rgba(8,15,30,0.85))' }} />
                <div style={{ display: 'flex', position: 'absolute', left: 44, top: 44, right: 44, justifyContent: 'space-between' }}>
                    {tag(lead.for?.[0] ? `Made for ${clip(lead.for[0], 16)}` : 'Pick for you', 'rgba(255,255,255,0.92)', INK)}
                    {lead.care?.[0] ? tag(clip(lead.care[0], 18), CORAL, '#fff') : null}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', position: 'absolute', left: 52, right: 52, bottom: 52, color: '#fff' }}>
                    <div style={{ display: 'flex', fontFamily: 'Fraunces', fontSize: 92, lineHeight: 1.02, letterSpacing: '-0.02em' }}>{clip(name, 26)}</div>
                    {area ? <div style={{ display: 'flex', marginTop: 10, fontFamily: 'Schibsted Grotesk', fontSize: 34, opacity: 0.88 }}>{clip(area, 48)}</div> : null}
                </div>
            </div>
            {creditText ? <div style={{ display: 'flex', minHeight: creditHeight, padding: '10px 28px', fontFamily: 'Schibsted Grotesk', fontSize: 20, lineHeight: 1.3, color: INK }}>{latin(creditText)}</div> : null}
            <div style={{ display: 'flex', flexDirection: 'column', padding: '40px 56px 0' }}>
                <div style={{ display: 'flex', alignItems: 'baseline' }}>
                    <div style={{ display: 'flex', fontFamily: 'Fraunces', fontSize: 84, color: INK }}>{clip(price ?? '', 18)}</div>
                </div>
                {catchTxt ? <div style={{ display: 'flex', marginTop: 8, fontFamily: 'Schibsted Grotesk', fontSize: 32, color: MUTE }}>{clip(`Catch: ${catchTxt}`, 56)}</div> : null}
                {chips.length ? (
                    <div style={{ display: 'flex', flexWrap: 'wrap', marginTop: 28 }}>
                        {chips.map((c, i) => (
                            <div key={i} style={{ display: 'flex', marginRight: 14, marginBottom: 12, padding: '12px 24px', borderRadius: 40, fontFamily: 'Schibsted Grotesk', fontSize: 28, background: c.ok ? '#DDF1E4' : '#FBE9D0', color: c.ok ? '#14532D' : '#7A3E00' }}>{c.ok ? c.t : `${c.t}: unverified`}</div>
                        ))}
                    </div>
                ) : null}
                {beat?.[0] ? (
                    <div style={{ display: 'flex', alignItems: 'center', marginTop: 16, paddingTop: 26, borderTop: '2px solid rgba(14,26,51,0.1)', fontFamily: 'Schibsted Grotesk', fontSize: 30, color: MUTE }}>
                        <div style={{ display: 'flex', marginRight: 16, fontFamily: 'DM Mono', fontSize: 22, letterSpacing: '0.12em', color: CORAL }}>BEAT</div>
                        <div style={{ display: 'flex' }}>{clip(`${beat[0]}${beat[1] ? `, ${beat[1]}` : ''}`, 60)}</div>
                    </div>
                ) : null}
                <Foot />
            </div>
        </div>
    )
    return { el, h: H }
}

const mins = (t: string): number => {
    let m = 0
    const h = t.match(/(\d+(?:\.\d+)?)\s*h/i), n = t.match(/(\d+)\s*m/i)
    if (h) m += Math.round(parseFloat(h[1]) * 60)
    if (n) m += parseInt(n[1], 10)
    return m
}

export function routeSummary(lines: string[]): { legs: string[][]; eta: string; first: string[]; last: string[]; hidden: number } | null {
    const all = lines.map(cells).filter((c) => c[0] && c[1])
    if (!all.length) return null
    const times = all.map((l) => mins(l[3] ?? ''))
    const total = times.reduce((a, n) => a + n, 0)
    const eta = times.every((n) => n > 0) ? (total >= 60 ? `${Math.floor(total / 60)} h ${total % 60 ? `${total % 60} min` : ''}`.trim() : `${total} min`) : `${all.length} ${all.length === 1 ? 'leg' : 'legs'}`
    return { legs: all.slice(0, 4), eta, first: all[0], last: all[all.length - 1], hidden: Math.max(0, all.length - 4) }
}

function routeCard(lines: string[]): { el: ReactElement; h: number } | null {
    const summary = routeSummary(lines)
    if (!summary) return null
    const { legs, eta, first, last, hidden } = summary
    const modes = Array.from(new Set(legs.map((l) => l[2]).filter(Boolean))).join(' + ')
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1080 520" width="1080" height="520"><path d="M110 350C250 335 330 235 480 228S690 270 790 175 920 118 960 108" stroke="rgba(240,138,104,0.3)" stroke-width="30" fill="none" stroke-linecap="round"/><path d="M110 350C250 335 330 235 480 228S690 270 790 175 920 118 960 108" stroke="#F08A68" stroke-width="9" fill="none" stroke-linecap="round" stroke-dasharray="2 24"/><circle cx="110" cy="350" r="24" fill="#fff"/><circle cx="110" cy="350" r="10" fill="#0E1A33"/><circle cx="960" cy="108" r="28" fill="#F08A68"/><circle cx="960" cy="108" r="10" fill="#fff"/></svg>`
    const art = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
    const H = 520 + 40 + legs.length * 118 + 70 + (hidden ? 50 : 0)
    const el = (
        <div style={{ width: W, height: H, display: 'flex', flexDirection: 'column', background: PAPER }}>
            <div style={{ display: 'flex', position: 'relative', width: W, height: 520, backgroundImage: 'linear-gradient(160deg, #16305A, #0E1A33)' }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={art} width={W} height={520} alt="" style={{ position: 'absolute', left: 0, top: 0 }} />
                <div style={{ display: 'flex', flexDirection: 'column', position: 'absolute', left: 52, top: 44, color: '#fff' }}>
                    <div style={{ display: 'flex', fontFamily: 'Fraunces', fontSize: 130, lineHeight: 1, letterSpacing: '-0.02em' }}>{eta}</div>
                    <div style={{ display: 'flex', marginTop: 14, fontFamily: 'DM Mono', fontSize: 24, letterSpacing: '0.14em', textTransform: 'uppercase', opacity: 0.75 }}>{clip(modes || 'Route', 30)}</div>
                </div>
                <div style={{ display: 'flex', position: 'absolute', left: 52, bottom: 36, fontFamily: 'Schibsted Grotesk', fontSize: 30, color: 'rgba(255,255,255,0.85)' }}>{clip(`${first[0]} to ${last[1]}`, 50)}</div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', padding: '20px 56px 0' }}>
                {legs.map((l, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', height: 118, borderBottom: i < legs.length - 1 ? '2px solid rgba(14,26,51,0.1)' : 'none' }}>
                        <div style={{ display: 'flex', width: 26, height: 26, borderRadius: 26, background: CORAL, marginRight: 30 }} />
                        <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
                            <div style={{ display: 'flex', fontFamily: 'Schibsted Grotesk', fontWeight: 600, fontSize: 36, color: INK }}>{clip(`${l[0]} to ${l[1]}`, 36)}</div>
                            <div style={{ display: 'flex', marginTop: 4, fontFamily: 'Schibsted Grotesk', fontSize: 28, color: MUTE }}>{clip([l[2], l[4]].filter(Boolean).join(' · '), 52)}</div>
                        </div>
                        <div style={{ display: 'flex', fontFamily: 'DM Mono', fontSize: 28, color: MUTE }}>{clip(l[3] ?? '', 12)}</div>
                    </div>
                ))}
                {hidden ? <div style={{ display: 'flex', fontFamily: 'Schibsted Grotesk', fontSize: 26, color: MUTE }}>{`+ ${hidden} more ${hidden === 1 ? 'leg' : 'legs'} on the page`}</div> : null}
                <Foot />
            </div>
        </div>
    )
    return { el, h: H }
}

function mediaCard(segs: ReturnType<typeof splitBlocks>, photos: CardPhoto[]): { el: ReactElement; h: number } | null {
    const blk = segs.find((x) => x.kind === 'block' && x.name === 'media')
    if (!blk || blk.kind !== 'block') return null
    const rows = blk.lines.map(cells).filter((c) => c[0])
    if (!rows.length) return null
    const lead = segs.find((x) => x.kind === 'block' && x.name === 'lead')
    const pickName = lead && lead.kind === 'block' ? (lead.lines.map(cells).find((c) => c[0]?.toLowerCase() === 'pick')?.[1] ?? '').toLowerCase() : ''
    const [title, kind, year, rating, by, why, photoPath] = rows.find((r) => pickName && r[0].toLowerCase() === pickName) ?? rows[0]
    const k = /book|game/i.test(kind ?? '') ? (kind as string).toLowerCase() : 'movie'
    const photo = photos.find((ph) => ph.path === photoPath && /^image\/(jpeg|png)$/.test(ph.contentType))
    const c1 = hsl(hue(title), 42, 28), c2 = hsl((hue(title) + 50) % 360, 45, 46)
    const credit = photo?.credit && photo.license !== 'cover' ? `Photo: ${photo.credit}${photo.license ? `, ${photo.license}` : ''}` : ''
    const H = 700 + (credit ? Math.ceil(credit.length / 65) * 26 + 20 : 0)
    const el = (
        <div style={{ width: W, height: H, display: 'flex', flexDirection: 'column', background: PAPER, padding: '48px 56px 28px' }}>
            <div style={{ display: 'flex', flex: 1 }}>
                <div style={{ display: 'flex', width: 320, height: 480, borderRadius: 24, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', backgroundImage: `linear-gradient(160deg, ${c1}, ${c2})`, boxShadow: '0 24px 48px rgba(14,26,51,0.3)' }}>
                    {photo ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={dataUri(photo)} width={320} height={480} alt="" style={{ width: 320, height: 480, objectFit: 'cover' }} />
                    ) : (
                        <div style={{ display: 'flex', padding: 28, color: '#fff', fontFamily: 'Fraunces', fontSize: 44, lineHeight: 1.1, textAlign: 'center' }}>{clip(title, 28)}</div>
                    )}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', flex: 1, marginLeft: 48 }}>
                    <div style={{ display: 'flex', fontFamily: 'DM Mono', fontSize: 24, letterSpacing: '0.14em', textTransform: 'uppercase', color: CORAL }}>{`${k} · pick`}</div>
                    <div style={{ display: 'flex', marginTop: 14, fontFamily: 'Fraunces', fontSize: 76, lineHeight: 1.04, letterSpacing: '-0.02em', color: INK }}>{clip(title, 30)}</div>
                    <div style={{ display: 'flex', marginTop: 18, fontFamily: 'Schibsted Grotesk', fontSize: 32, color: MUTE }}>{clip([year, by].filter(Boolean).join(' · '), 40)}</div>
                    {rating ? (
                        <div style={{ display: 'flex', marginTop: 22 }}>
                            <div style={{ display: 'flex', padding: '10px 26px', borderRadius: 40, background: CORAL, color: '#fff', fontFamily: 'Schibsted Grotesk', fontWeight: 600, fontSize: 32 }}>{clip(rating, 16)}</div>
                        </div>
                    ) : null}
                    {why ? <div style={{ display: 'flex', marginTop: 24, fontFamily: 'Schibsted Grotesk', fontSize: 32, lineHeight: 1.35, color: 'rgba(14,26,51,0.8)' }}>{clip(why, 110)}</div> : null}
                </div>
            </div>
            {credit ? <div style={{ display: 'flex', marginTop: 20, fontFamily: 'Schibsted Grotesk', fontSize: 20, lineHeight: 1.3, color: MUTE }}>{latin(credit)}</div> : null}
            <Foot />
        </div>
    )
    return { el, h: H }
}

function briefingCard(title: string, subtitle: string | undefined, lines: string[]): { el: ReactElement; h: number } | null {
    const items = lines.slice(0, 4).map(cells).filter((c) => c[0])
    if (!items.length) return null
    const H = 440 + items.length * 150 + 90
    const el = (
        <div style={{ width: W, height: H, display: 'flex', flexDirection: 'column', background: PAPER }}>
            <div style={{ display: 'flex', flexDirection: 'column', position: 'relative', height: 440, padding: '48px 56px', color: '#fff', overflow: 'hidden', backgroundImage: 'linear-gradient(180deg, #27406F, #E2866A 72%, #F4C27A)' }}>
                <Brand color="rgba(255,255,255,0.92)" />
                <div style={{ display: 'flex', position: 'absolute', right: -40, bottom: -90, width: 300, height: 300, borderRadius: 300, backgroundImage: 'linear-gradient(180deg, #FFE2A0, #F4A96B)', opacity: 0.9 }} />
                <div style={{ display: 'flex', marginTop: 70, fontFamily: 'Fraunces', fontSize: 96, lineHeight: 1.02, letterSpacing: '-0.02em' }}>{clip(title, 34)}</div>
                {subtitle ? <div style={{ display: 'flex', marginTop: 14, fontFamily: 'Schibsted Grotesk', fontSize: 32, opacity: 0.9 }}>{clip(subtitle, 56)}</div> : null}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', padding: '10px 56px 0' }}>
                {items.map((it, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', height: 150, borderBottom: i < items.length - 1 ? '2px solid rgba(14,26,51,0.1)' : 'none' }}>
                        <div style={{ display: 'flex', width: 76, fontFamily: 'DM Mono', fontSize: 28, color: CORAL }}>{String(i + 1).padStart(2, '0')}</div>
                        <div style={{ display: 'flex', flex: 1, fontFamily: 'Schibsted Grotesk', fontSize: 36, lineHeight: 1.3, color: INK }}>{clip(it[3] || it[0], 78)}</div>
                    </div>
                ))}
            </div>
            <div style={{ display: 'flex', padding: '0 56px', marginTop: 'auto', marginBottom: 28 }}><Foot /></div>
        </div>
    )
    return { el, h: H }
}

/** PNG for the first weather, scores, stay, route, media or briefing block on the page (in page order), or null when it has none. Photos are the copies the page builder made. */
export async function renderKindCard(doc: { title: string; subtitle?: string; body: string }, photos: CardPhoto[] = []): Promise<Buffer | null> {
    if (/[^\u0000-\u024F\u2010-\u2027\u20AC\u2122]/u.test([doc.title, doc.subtitle ?? '', doc.body, ...photos.map((p) => p.credit ?? '')].join(' ').replace(/[\p{Symbol}\p{Mark}]/gu, ''))) return null
    const segs = splitBlocks(doc.body)
    const seg = segs.find((x) => x.kind === 'block' && ['weather', 'scores', 'stay', 'route', 'media', 'briefing'].includes(x.name))
    if (!seg || seg.kind !== 'block') return null
    const built = seg.name === 'weather' ? weatherCard(seg.lines) : seg.name === 'scores' ? scoresCard(doc.title, doc.subtitle, seg.lines) : seg.name === 'stay' ? stayCard(segs, photos) : seg.name === 'media' ? mediaCard(segs, photos) : seg.name === 'briefing' ? briefingCard(doc.title, doc.subtitle, seg.lines) : routeCard(seg.lines)
    if (!built) return null
    const res = new ImageResponse(built.el, { width: W, height: built.h, fonts: fonts() })
    return Buffer.from(await res.arrayBuffer())
}
