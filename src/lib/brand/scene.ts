/**
 * The Dinghy scene as plain SVG strings, so one drawing ships everywhere:
 * React pages (inline), the OG image renderer (data URI) and PDFs.
 *   sunriseSvg    - paper surfaces: sunrise over water, clouds, the dinghy
 *   firstLightSvg - night surfaces: the same sea before dawn
 */

function cloud(x: number, y: number, s = 1, o = 0.92): string {
    return `<g transform="translate(${x} ${y}) scale(${s})" opacity="${o}">` +
        '<path d="M-120 30 C-122 8 -100 -4 -82 2 C-76 -26 -40 -38 -18 -18 C-8 -48 40 -52 56 -20 C80 -32 112 -14 106 14 C126 16 132 30 124 36 L-112 36 C-122 36 -124 32 -120 30 Z" fill="#FFF6EC"/>' +
        '<path d="M-116 36 L124 36 C118 30 106 26 96 28 C84 22 66 26 58 30 C40 24 12 26 0 30 C-20 24 -52 26 -66 30 C-84 24 -104 28 -116 36 Z" fill="#F4C9B6" opacity="0.7"/>' +
        '</g>'
}

function dinghy(x: number, y: number, s = 1, c = '#1B2A4A'): string {
    return `<g transform="translate(${x} ${y}) scale(${s})">` +
        `<path d="M-22 0 L22 0 L15 9 L-16 9 Z" fill="${c}"/>` +
        `<path d="M0 0 L0 -40" stroke="${c}" stroke-width="1.8"/>` +
        `<path d="M1.5 -38 L1.5 -3 L20 -3 Z" fill="${c}"/>` +
        `<path d="M-1.5 -30 L-1.5 -3 L-14 -3 Z" fill="${c}" opacity="0.75"/>` +
        `<path d="M-26 13 L26 13" stroke="${c}" stroke-width="1.2" opacity="0.25" stroke-linecap="round"/>` +
        '</g>'
}

export interface SunriseOptions {
    /** x of the sun in the 1200x630 viewBox */
    sunX?: number
    /** y of the horizon in the 1200x630 viewBox */
    horizon?: number
    /** x of the boat; defaults to the right of the sun */
    boatX?: number
    /** unique id prefix when several scenes share a page */
    id?: string
    /** SVG preserveAspectRatio; slice for backgrounds */
    fit?: string
    /** explicit pixel size (needed for data-URI rendering) */
    width?: number
    height?: number
    /** also draw clouds (on by default) */
    clouds?: boolean
}

export function sunriseSvg(o: SunriseOptions = {}): string {
    const sunX = o.sunX ?? 900
    const H = o.horizon ?? 420
    const boatX = o.boatX ?? sunX + 170
    const id = o.id ?? 's'
    const size = o.width && o.height ? ` width="${o.width}" height="${o.height}"` : ''
    const f = (n: number) => String(Math.round(n * 1000) / 1000)
    const sea: string[] = []
    for (let i = 0; i < 7; i++) {
        const w = 150 - i * 18
        sea.push(`<rect x="${sunX - w / 2}" y="${H + 10 + i * 17}" width="${w}" height="4" rx="2" fill="#FFE2AA" opacity="${f(0.85 - i * 0.1)}"/>`)
    }
    const shimmer = [[80, 470, 180], [420, 505, 120], [140, 560, 240], [620, 470, 90], [700, 590, 200], [1040, 540, 120], [960, 600, 160]]
        .map(([x, y, w]) => `<rect x="${x}" y="${y + (H - 420)}" width="${w}" height="2.5" rx="1.25" fill="#FFF3E6" opacity="0.28"/>`).join('')
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630" preserveAspectRatio="${o.fit ?? 'xMidYMid slice'}"${size} aria-hidden="true">` +
        '<defs>' +
        `<linearGradient id="${id}-sky" x1="0" y1="0" x2="0" y2="${H}" gradientUnits="userSpaceOnUse">` +
        '<stop offset="0" stop-color="#2F3F73"/><stop offset="0.42" stop-color="#7F93C9"/><stop offset="0.72" stop-color="#E7B5B0"/><stop offset="0.9" stop-color="#F7C196"/><stop offset="1" stop-color="#F79E75"/>' +
        '</linearGradient>' +
        `<radialGradient id="${id}-glow" cx="${sunX}" cy="${H}" r="360" gradientUnits="userSpaceOnUse">` +
        '<stop offset="0" stop-color="#FFE6B8" stop-opacity="0.95"/><stop offset="0.35" stop-color="#FFD2A0" stop-opacity="0.45"/><stop offset="1" stop-color="#FFD2A0" stop-opacity="0"/>' +
        '</radialGradient>' +
        `<linearGradient id="${id}-sea" x1="0" y1="${H}" x2="0" y2="630" gradientUnits="userSpaceOnUse">` +
        '<stop offset="0" stop-color="#E59A86"/><stop offset="0.25" stop-color="#A493B4"/><stop offset="0.6" stop-color="#5B72A8"/><stop offset="1" stop-color="#2A3A68"/>' +
        '</linearGradient>' +
        `<clipPath id="${id}-above"><rect x="0" y="0" width="1200" height="${H}"/></clipPath>` +
        '</defs>' +
        `<rect width="1200" height="${H + 1}" fill="url(#${id}-sky)"/>` +
        `<rect width="1200" height="${H}" fill="url(#${id}-glow)"/>` +
        `<circle cx="${sunX}" cy="${H + 6}" r="64" fill="#FFE2AA" clip-path="url(#${id}-above)"/>` +
        `<path d="M140 ${H - 70} L 420 ${H - 70}" stroke="#FBDCCB" stroke-width="6" opacity="0.5" stroke-linecap="round"/>` +
        `<path d="M${sunX + 90} ${H - 118} L ${sunX + 250} ${H - 118}" stroke="#FFE9D6" stroke-width="7" opacity="0.55" stroke-linecap="round"/>` +
        (o.clouds === false ? '' : cloud(220, 150, 1.25) + cloud(sunX + 120, 96, 0.9, 0.88) + cloud(620, 230, 0.62, 0.8)) +
        `<rect y="${H}" width="1200" height="${630 - H}" fill="url(#${id}-sea)"/>` +
        sea.join('') + shimmer +
        dinghy(boatX, H + 40, 1.1) +
        '</svg>'
}

export function firstLightSvg(o: { id?: string; boatX?: number; horizon?: number; fit?: string } = {}): string {
    const H = o.horizon ?? 470
    const id = o.id ?? 'n'
    const stars = [[90, 80], [210, 150], [330, 60], [470, 120], [610, 40], [760, 100], [880, 170], [1010, 70], [1120, 130], [540, 210], [160, 260], [1060, 250]]
        .map(([x, y], i) => `<circle cx="${x}" cy="${y * H / 470}" r="${i % 3 === 0 ? 1.6 : 1}" fill="#F3EDE3" opacity="${i % 2 ? 0.5 : 0.8}"/>`).join('')
    const shimmer = [[120, 40, 200], [520, 70, 140], [860, 35, 220], [300, 115, 160], [980, 120, 120]]
        .map(([x, dy, w]) => `<rect x="${x}" y="${H + dy}" width="${w}" height="2" rx="1" fill="#F3EDE3" opacity="0.12"/>`).join('')
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630" preserveAspectRatio="${o.fit ?? 'xMidYMid slice'}" aria-hidden="true">` +
        '<defs>' +
        `<linearGradient id="${id}-sky" x1="0" y1="0" x2="0" y2="${H}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#060B1A"/><stop offset="0.6" stop-color="#0C1733"/><stop offset="0.9" stop-color="#2A2A4E"/><stop offset="1" stop-color="#6B4A5E"/></linearGradient>` +
        `<linearGradient id="${id}-sea" x1="0" y1="${H}" x2="0" y2="630" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#1A2344"/><stop offset="1" stop-color="#060B1A"/></linearGradient>` +
        '</defs>' +
        `<rect width="1200" height="${H + 1}" fill="url(#${id}-sky)"/>` + stars +
        `<path d="M0 ${H - 1} L1200 ${H - 1}" stroke="#F2A380" stroke-width="2" opacity="0.55"/>` +
        `<rect y="${H}" width="1200" height="${630 - H}" fill="url(#${id}-sea)"/>` + shimmer +
        dinghy(o.boatX ?? 760, H + 30, 1.1, '#F3EDE3') +
        '</svg>'
}

export function anchorSvg(color = '#0E1A33', size = 24): string {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">` +
        '<circle cx="12" cy="5" r="2"/><path d="M12 7v14"/><path d="M8 11h8"/><path d="M4.5 14.5c0 3.6 3.4 6.5 7.5 6.5s7.5-2.9 7.5-6.5"/></svg>'
}

export function svgDataUri(svg: string): string {
    return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
}
