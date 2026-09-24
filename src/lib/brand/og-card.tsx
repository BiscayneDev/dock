import { ImageResponse } from 'next/og'
import { CARD_BG_JPEG, MARK_PNG } from './card-art'
import { dmMono500, frauncesDisplay, frauncesItalic, schibsted400 } from './static-fonts'

const W = 1200
const H = 630

const fontData = (b64: string): ArrayBuffer => {
    const buf = Buffer.from(b64, 'base64')
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
}

/** Panel width: leaves the boat and ship in the art visible on the right. */
const PANEL_W = 600

export interface OgCardInput {
    /** small mono label top-left, e.g. "dinghy" or "pdf · 3 pages" */
    label: string
    /** lowercase headline */
    title: string
    /** optional italic accent appended to the headline */
    accent?: string
    /** optional one-sentence line under the headline */
    sub?: string
    /** small mono label at the bottom */
    foot: string
}

/** Coast-illustration card with a cream panel. The brand's link card, 1200x630. */
export function renderOgCard(input: OgCardInput): ImageResponse {
    const words = input.title.split(/\s+/).filter(Boolean)
    const accentWords = (input.accent ?? '').split(/\s+/).filter(Boolean)
    const length = input.title.length + (input.accent ? input.accent.length + 1 : 0)
    const size = length > 60 ? 44 : length > 34 ? 52 : 60

    return new ImageResponse(
        (
            <div style={{ width: W, height: H, display: 'flex', position: 'relative', background: '#0E1A33' }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={CARD_BG_JPEG} width={W} height={H} alt="" style={{ position: 'absolute', left: 0, top: 0 }} />
                <div
                    style={{
                        position: 'absolute', left: 48, top: 48, width: PANEL_W, height: H - 96,
                        display: 'flex', flexDirection: 'column',
                        background: '#FBF6EE', borderRadius: 32, padding: '46px 50px',
                        boxShadow: '0 24px 60px rgba(14,26,51,0.22)',
                    }}
                >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={MARK_PNG} width={40} height={40} alt="" style={{ borderRadius: 9 }} />
                        <div style={{ fontFamily: 'DM Mono', fontSize: 15, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'rgba(14,26,51,0.7)' }}>{input.label}</div>
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', marginTop: 'auto', fontSize: size, lineHeight: 1.04, letterSpacing: '-0.02em', color: '#0E1A33' }}>
                        {words.map((w, i) => <span key={`w${i}`} style={{ fontFamily: 'Fraunces', marginRight: size * 0.24 }}>{w}</span>)}
                        {accentWords.map((w, i) => <span key={`a${i}`} style={{ fontFamily: 'Fraunces Italic', fontStyle: 'italic', color: '#C8583A', marginRight: size * 0.24 }}>{w}</span>)}
                    </div>
                    {input.sub && (
                        <div style={{ display: 'flex', marginTop: 18, fontFamily: 'Schibsted Grotesk', fontSize: 24, lineHeight: 1.4, color: 'rgba(14,26,51,0.72)' }}>{input.sub}</div>
                    )}
                    <div style={{ display: 'flex', marginTop: 'auto', fontFamily: 'DM Mono', fontSize: 15, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'rgba(14,26,51,0.7)' }}>{input.foot}</div>
                </div>
            </div>
        ),
        {
            width: W,
            height: H,
            fonts: [
                { name: 'Fraunces', data: fontData(frauncesDisplay), weight: 500, style: 'normal' },
                { name: 'Fraunces Italic', data: fontData(frauncesItalic), weight: 400, style: 'italic' },
                { name: 'Schibsted Grotesk', data: fontData(schibsted400), weight: 400, style: 'normal' },
                { name: 'DM Mono', data: fontData(dmMono500), weight: 500, style: 'normal' },
            ],
            headers: { 'Cache-Control': 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800' },
        },
    )
}

/** Trim to a max length on a word boundary. */
export function clip(s: string, max: number): string {
    const t = s.replace(/\s+/g, ' ').trim()
    if (t.length <= max) return t
    const cut = t.slice(0, max - 1)
    return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), max - 12)).trim()}…`
}
