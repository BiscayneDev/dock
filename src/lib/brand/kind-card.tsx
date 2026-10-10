import type { ReactElement } from 'react'
import { ImageResponse } from 'next/og'
import { MARK_PNG } from './card-art'
import { dmMono500, frauncesDisplay, schibsted400, schibsted600 } from './static-fonts'
import { cells, hue, num, skyIcon, skyOf } from '@/lib/files/kinds'
import { splitBlocks } from '@/lib/files/render'

/**
 * Phone-width preview cards for hosted pages, sent into the chat above the
 * link. Slice 1: weather and scores. Satori draws these (flexbox only), so
 * each kind has its own layout; the data comes from the same pipe lines the
 * page uses. Built from the finished page body only: no network, no photos.
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
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}...` : s)

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
                <div style={{ display: 'flex', marginTop: 10, fontFamily: 'Fraunces', fontSize: 230, lineHeight: 1, letterSpacing: '-0.03em' }}>{now}</div>
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

/** PNG for the first weather or scores block on the page, or null when it has neither. */
export async function renderKindCard(doc: { title: string; subtitle?: string; body: string }): Promise<Buffer | null> {
    const seg = splitBlocks(doc.body).find((s) => s.kind === 'block' && (s.name === 'weather' || s.name === 'scores'))
    if (!seg || seg.kind !== 'block') return null
    const built = seg.name === 'weather' ? weatherCard(seg.lines) : scoresCard(doc.title, doc.subtitle, seg.lines)
    if (!built) return null
    const res = new ImageResponse(built.el, { width: W, height: built.h, fonts: fonts() })
    return Buffer.from(await res.arrayBuffer())
}
