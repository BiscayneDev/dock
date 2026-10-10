/**
 * Open-now from OpenStreetMap `opening_hours` strings. Covers the common
 * subset ("Mo-Fr 11:00-14:00,17:00-22:00; Sa 11:00-22:00; Su off", "24/7").
 * Anything it cannot read with certainty (holidays, months, weeks, sunrise)
 * comes back "unknown". It never guesses open or closed.
 */
export type OpenState = 'open' | 'closed' | 'unknown'
export interface OpenStatus { state: OpenState; text: string }

const DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']
const UNKNOWN: OpenStatus = { state: 'unknown', text: 'Hours not listed' }

function dayIndexes(spec: string): number[] | null {
    const out = new Set<number>()
    for (const part of spec.split(',')) {
        const p = part.trim()
        const m = p.match(/^([A-Z][a-z])(?:-([A-Z][a-z]))?$/)
        if (!m) return null
        const a = DAYS.indexOf(m[1]!)
        const b = m[2] ? DAYS.indexOf(m[2]) : a
        if (a < 0 || b < 0) return null
        for (let i = a; ; i = (i + 1) % 7) { out.add(i); if (i === b) break }
    }
    return [...out]
}

const toMin = (t: string): number => { const [h, m] = t.split(':').map(Number); return h! * 60 + m! }
const fmt = (min: number): string => `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`

interface Rule { days: number[]; ranges: [number, number][] }

function parse(hours: string): Rule[] | '24/7' | null {
    const h = hours.trim()
    if (h === '24/7') return '24/7'
    if (/(PH|SH|week|sunrise|sunset|dusk|dawn|"|\[|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|\+|easter)/i.test(h)) return null
    const rules: Rule[] = []
    for (const raw of h.split(';')) {
        const r = raw.trim()
        if (!r) continue
        const m = r.match(/^(?:([A-Za-z,\-\s]+?)\s+)?(off|closed|\d{1,2}:\d{2}-\d{1,2}:\d{2}(?:\s*,\s*\d{1,2}:\d{2}-\d{1,2}:\d{2})*)$/)
        if (!m) return null
        const days = m[1] ? dayIndexes(m[1].replace(/\s+/g, '')) : [0, 1, 2, 3, 4, 5, 6]
        if (!days) return null
        const ranges: [number, number][] = /^(off|closed)$/.test(m[2]!) ? [] : m[2]!.split(',').map((x) => {
            const [a, b] = x.trim().split('-')
            return [toMin(a!), toMin(b!)] as [number, number]
        })
        rules.push({ days, ranges })
    }
    return rules.length ? rules : null
}

/** Intervals (in minutes from the start of `day`) when open, folding in a spill from yesterday's overnight range. */
function intervalsFor(rules: Rule[], day: number): [number, number][] {
    let today: [number, number][] = []
    let yesterday: [number, number][] = []
    const prev = (day + 6) % 7
    for (const r of rules) {
        if (r.days.includes(day)) today = r.ranges
        if (r.days.includes(prev)) yesterday = r.ranges
    }
    const out: [number, number][] = []
    for (const [a, b] of yesterday) if (b <= a) out.push([0, b])
    for (const [a, b] of today) out.push(b <= a ? [a, 24 * 60] : [a, b])
    return out
}

/** Local day-of-week (0=Sun) and minutes since midnight in an IANA zone. */
export function localParts(now: Date, timeZone: string): { day: number; minutes: number } | null {
    try {
        const p = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now)
        const wd = p.find((x) => x.type === 'weekday')?.value ?? ''
        const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(wd)
        const h = Number(p.find((x) => x.type === 'hour')?.value)
        const m = Number(p.find((x) => x.type === 'minute')?.value)
        if (day < 0 || !Number.isFinite(h) || !Number.isFinite(m)) return null
        return { day, minutes: h * 60 + m }
    } catch {
        return null
    }
}

export function openStatus(hours: string | undefined, now: Date, timeZone: string): OpenStatus {
    if (!hours) return UNKNOWN
    const parsed = parse(hours)
    const lp = localParts(now, timeZone)
    if (!parsed || !lp) return UNKNOWN
    if (parsed === '24/7') return { state: 'open', text: 'Open 24 hours' }
    const iv = intervalsFor(parsed, lp.day)
    const cur = iv.find(([a, b]) => lp.minutes >= a && lp.minutes < b)
    if (cur) {
        const spill = cur[1] >= 24 * 60 ? (intervalsFor(parsed, (lp.day + 1) % 7).find(([a]) => a === 0)?.[1] ?? 0) : 0
        const end = cur[1] + spill
        const closesSoon = end - lp.minutes <= 60
        return { state: 'open', text: `Open now, until ${fmt(end)}${closesSoon ? ' (closing soon)' : ''}` }
    }
    const next = iv.filter(([a]) => a > lp.minutes).sort((x, y) => x[0] - y[0])[0]
    if (next) return { state: 'closed', text: `Closed, opens ${fmt(next[0])}` }
    for (let i = 1; i <= 7; i++) {
        const d = (lp.day + i) % 7
        const first = intervalsFor(parsed, d).sort((x, y) => x[0] - y[0])[0]
        if (first) return { state: 'closed', text: `Closed, opens ${i === 1 ? 'tomorrow' : DAYS[d]} ${fmt(first[0])}` }
    }
    return { state: 'closed', text: 'Closed' }
}
