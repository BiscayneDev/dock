import { ImageResponse } from 'next/og'
import { CARD_BG_JPEG, MARK_PNG } from './card-art'
import { dmMono500, frauncesDisplay, frauncesItalic, schibsted400 } from './static-fonts'

/** Portrait so it reads full-width in an iMessage thread. */
const W = 1080
const ART_H = 567 // the 1200x630 card art at 0.9
const NAVY = '#0E1A33'
const CREAM = '#FBF6EE'
const EMBER = '#C8583A'
const INK_SOFT = 'rgba(14,26,51,0.62)'

const fontData = (b64: string): ArrayBuffer => {
    const buf = Buffer.from(b64, 'base64')
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
}

export interface BriefCardInput {
    /** e.g. "wednesday, september 23" */
    date: string
    /** e.g. "8:02 am" */
    time: string
    /** first-person opener, one sentence */
    opener: string
    /** optional italic ember words appended to the opener */
    accent?: string
    /** today's calendar */
    onDeck: Array<{ when: string; what: string; note?: string }>
    /** email that actually matters */
    worth: Array<{ tag: string; from: string; what: string }>
    /** conditions where they are; shown top-right over the art */
    weather?: { place: string; temp: number; sky: string; high: number; low: number; wind?: string; rain?: number; note?: string }
    /** everything else, summarized */
    rest?: { count: number; from: string[] }
}

const label = (text: string, color = EMBER) => (
    <div style={{ display: 'flex', fontFamily: 'DM Mono', fontSize: 19, letterSpacing: '0.18em', textTransform: 'uppercase', color }}>{text}</div>
)

function Row({ left, title, sub, first }: { left: string; title: string; sub?: string; first: boolean }) {
    return (
        <div style={{ display: 'flex', alignItems: 'flex-start', paddingTop: 22, paddingBottom: 22, borderTop: first ? 'none' : '1.5px solid rgba(14,26,51,0.09)' }}>
            <div style={{ display: 'flex', width: 200, flexShrink: 0, paddingTop: 6, fontFamily: 'DM Mono', fontSize: 21, letterSpacing: '0.04em', color: INK_SOFT }}>{left}</div>
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
                <div style={{ display: 'flex', fontFamily: 'Schibsted Grotesk', fontSize: 31, lineHeight: 1.3, color: NAVY }}>{title}</div>
                {sub && <div style={{ display: 'flex', marginTop: 4, fontFamily: 'Schibsted Grotesk', fontSize: 25, lineHeight: 1.35, color: INK_SOFT }}>{sub}</div>}
            </div>
        </div>
    )
}

/** Height grows with content so nothing gets cut and short days stay short. */
function heightFor(b: BriefCardInput): number {
    const opener = (b.opener.length + (b.accent?.length ?? 0)) > 92 ? 3 : 2
    const rows = b.onDeck.length + b.worth.length
    const subs = b.onDeck.filter((r) => r.note).length + b.worth.length
    return ART_H - 40 + 90 + opener * 60 + 60 + (b.onDeck.length ? 90 : 0) + (b.worth.length ? 90 : 0) + rows * 86 + subs * 34 + (b.rest ? 150 : 0) + 70 + (b.weather?.note ? 110 : 0)
}

/** The morning brief as a designed card: coast art header, cream log below. */
export function renderBriefCard(b: BriefCardInput): ImageResponse {
    const H = heightFor(b)
    const openerWords = b.opener.split(/\s+/).filter(Boolean)
    const accentWords = (b.accent ?? '').split(/\s+/).filter(Boolean)
    return new ImageResponse(
        (
            <div style={{ width: W, height: H, display: 'flex', flexDirection: 'column', position: 'relative', background: CREAM }}>
                {/* header art */}
                <div style={{ display: 'flex', position: 'relative', width: W, height: ART_H }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={CARD_BG_JPEG} width={1200} height={630} alt="" style={{ position: 'absolute', left: -60, top: -30 }} />
                    <div style={{ position: 'absolute', left: 0, top: 0, width: W, height: ART_H, display: 'flex', background: 'linear-gradient(180deg, rgba(14,26,51,0.62) 0%, rgba(14,26,51,0.18) 26%, rgba(14,26,51,0) 38%, rgba(14,26,51,0) 45%, rgba(14,26,51,0.72) 100%)' }} />
                    <div style={{ position: 'absolute', left: 64, top: 56, display: 'flex', alignItems: 'center', gap: 16 }}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={MARK_PNG} width={48} height={48} alt="" style={{ borderRadius: 11 }} />
                        <div style={{ display: 'flex', fontFamily: 'Fraunces', fontSize: 34, color: CREAM, letterSpacing: '-0.01em' }}>dinghy</div>
                    </div>
                    {b.weather && (
                        <div style={{ position: 'absolute', right: 64, top: 50, display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                            <div style={{ display: 'flex', alignItems: 'flex-start', fontFamily: 'Fraunces', fontSize: 64, lineHeight: 1, letterSpacing: '-0.03em', color: CREAM }}>
                                {`${Math.round(b.weather.temp)}\u00b0`}
                            </div>
                            <div style={{ display: 'flex', marginTop: 10 }}>{label(`${b.weather.place} \u00b7 ${b.weather.sky}`, 'rgba(251,246,238,0.9)')}</div>
                            <div style={{ display: 'flex', marginTop: 6 }}>{label(`H ${Math.round(b.weather.high)}\u00b0  L ${Math.round(b.weather.low)}\u00b0${b.weather.wind ? `  \u00b7  ${b.weather.wind}` : ''}`, 'rgba(251,246,238,0.72)')}</div>
                        </div>
                    )}
                    <div style={{ position: 'absolute', left: 64, bottom: 84, display: 'flex', flexDirection: 'column' }}>
                        {label(`morning log · ${b.time}`, 'rgba(251,246,238,0.82)')}
                        <div style={{ display: 'flex', marginTop: 12, fontFamily: 'Fraunces', fontSize: 72, lineHeight: 1, letterSpacing: '-0.025em', color: CREAM }}>{b.date}</div>
                    </div>
                </div>

                {/* the log */}
                <div style={{ display: 'flex', flexDirection: 'column', flex: 1, marginTop: -40, background: CREAM, borderTopLeftRadius: 40, borderTopRightRadius: 40, padding: '58px 64px 0' }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', fontSize: 48, lineHeight: 1.16, letterSpacing: '-0.02em', color: NAVY }}>
                        {openerWords.map((w, i) => <span key={`o${i}`} style={{ fontFamily: 'Fraunces', marginRight: 12 }}>{w}</span>)}
                        {accentWords.map((w, i) => <span key={`a${i}`} style={{ fontFamily: 'Fraunces Italic', fontStyle: 'italic', color: EMBER, marginRight: 12 }}>{w}</span>)}
                    </div>

                    {b.weather?.note && (
                        <div style={{ display: 'flex', alignItems: 'center', marginTop: 34, padding: '18px 24px', borderRadius: 18, border: '1.5px solid rgba(200,88,58,0.35)' }}>
                            <div style={{ display: 'flex', width: 176, flexShrink: 0 }}>{label('conditions')}</div>
                            <div style={{ display: 'flex', fontFamily: 'Schibsted Grotesk', fontSize: 27, color: NAVY }}>{b.weather.note}</div>
                        </div>
                    )}

                    {b.onDeck.length > 0 && (
                        <div style={{ display: 'flex', flexDirection: 'column', marginTop: 52 }}>
                            {label('on deck')}
                            <div style={{ display: 'flex', flexDirection: 'column', marginTop: 10 }}>
                                {b.onDeck.map((r, i) => <Row key={`d${i}`} left={r.when} title={r.what} sub={r.note} first={i === 0} />)}
                            </div>
                        </div>
                    )}

                    {b.worth.length > 0 && (
                        <div style={{ display: 'flex', flexDirection: 'column', marginTop: 40 }}>
                            {label('worth a look')}
                            <div style={{ display: 'flex', flexDirection: 'column', marginTop: 10 }}>
                                {b.worth.map((r, i) => <Row key={`w${i}`} left={r.tag.toLowerCase()} title={r.from} sub={r.what} first={i === 0} />)}
                            </div>
                        </div>
                    )}

                    {b.rest && b.rest.count > 0 && (
                        <div style={{ display: 'flex', flexDirection: 'column', marginTop: 40, padding: '26px 30px', borderRadius: 22, background: '#F2EADC' }}>
                            {label('left in port', INK_SOFT)}
                            <div style={{ display: 'flex', marginTop: 10, fontFamily: 'Schibsted Grotesk', fontSize: 27, lineHeight: 1.4, color: NAVY }}>
                                {`${b.rest.count} more${b.rest.from.length ? ` from ${b.rest.from.slice(0, 3).join(', ')}` : ''}. nothing that needs you.`}
                            </div>
                        </div>
                    )}

                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 'auto', marginBottom: 52, paddingTop: 24, borderTop: '1.5px solid rgba(14,26,51,0.12)' }}>
                        {label('reply "mute mornings" to stop these', 'rgba(14,26,51,0.45)')}
                        {label('getdinghy.sh', 'rgba(14,26,51,0.45)')}
                    </div>
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
        },
    )
}
