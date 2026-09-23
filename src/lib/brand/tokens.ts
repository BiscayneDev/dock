/**
 * Dinghy design tokens. Source of truth for the site, connect pages, OG cards
 * and the file renderer. Two surfaces, one brand:
 *   night   - getdinghy.sh (first light over the water)
 *   paper   - everything Dinghy sends you (sunrise over the water)
 */
export const night = {
    abyss: '#060B1A',
    deep: '#0C1530',
    line: 'rgba(200,210,235,0.12)',
    shell: '#F3EDE3',
    mist: '#B7C0D6',
    fade: '#8290AE',
    ember: '#F2A380',
    button: '#F6EFE4',
} as const

export const paper = {
    cream: '#FBF6EE',
    sand: '#F1E8DA',
    midnight: '#0E1A33',
    body: 'rgba(14,26,51,0.78)',
    muted: 'rgba(14,26,51,0.55)',
    line: 'rgba(14,26,51,0.12)',
    coral: '#C8583A',
    // Solid equivalents for renderers that cannot do alpha (PDF, DOCX)
    bodySolid: '#3A4458',
    mutedSolid: '#6E7585',
    lineSolid: '#E2DCD2',
} as const

export const sunrise = {
    dusk: '#2F3F73',
    periwinkle: '#7F93C9',
    blush: '#E7B5B0',
    peach: '#F7C196',
    horizon: '#F79E75',
    sun: '#FFE2AA',
} as const

export const SITE_TAGLINE = 'your first mate lives in your texts'
