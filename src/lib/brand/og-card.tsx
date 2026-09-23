import { ImageResponse } from 'next/og'
import { anchorSvg, sunriseSvg, svgDataUri } from './scene'
import { dmMono500, frauncesDisplay, frauncesItalic, schibsted400 } from './static-fonts'

const W = 1200
const H = 630

const fontData = (b64: string): ArrayBuffer => {
    const buf = Buffer.from(b64, 'base64')
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
}

let scene: string | null = null
const sceneUri = (): string => (scene ??= svgDataUri(sunriseSvg({ id: 'og', sunX: 900, boatX: 1065, horizon: 420, width: W, height: H })))
const anchorUri = svgDataUri(anchorSvg('#0E1A33', 34))

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

/** Sunrise-over-water card with a cream panel. The brand's link card, 1200x630. */
export function renderOgCard(input: OgCardInput): ImageResponse {
    const words = input.title.split(/\s+/).filter(Boolean)
    const accentWords = (input.accent ?? '').split(/\s+/).filter(Boolean)
    const length = input.title.length + (input.accent ? input.accent.length + 1 : 0)
    const size = length > 60 ? 50 : length > 34 ? 58 : 66

    return new ImageResponse(
        (
            <div style={{ width: W, height: H, display: 'flex', position: 'relative', background: '#F79E75' }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={sceneUri()} width={W} height={H} alt="" style={{ position: 'absolute', left: 0, top: 0 }} />
                <div
                    style={{
                        position: 'absolute', left: 56, top: 56, width: 696, height: H - 112,
                        display: 'flex', flexDirection: 'column',
                        background: '#FBF6EE', borderRadius: 32, padding: '52px 58px',
                        boxShadow: '0 24px 60px rgba(14,26,51,0.22)',
                    }}
                >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={anchorUri} width={34} height={34} alt="" />
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
