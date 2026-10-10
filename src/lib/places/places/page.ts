import type { Place } from './osm'

const dist = (p: Place): string => `${p.walkMin} min walk · ${p.distanceM >= 1000 ? (p.distanceM / 1000).toFixed(1) + ' km' : p.distanceM + ' m'}`
const clean = (s: string | undefined): string => (s ?? '').replace(/[|\n]/g, ' ').trim()

/** One :::places line. Never invents a field: missing data stays empty. */
export function placeLine(p: Place): string {
    return [clean(p.name), p.status.state, p.status.text, dist(p), clean(p.address), clean(p.hours), `${p.lat.toFixed(5)},${p.lon.toFixed(5)}`, p.website ?? '', clean(p.phone)].join(' | ')
}

export interface PlacesDoc {
    title: string
    subtitle: string
    body: string
    /** Plain text fallback for the chat reply when the page cannot go out. */
    text: string
}

export function buildPlacesDoc(opts: { places: Place[]; what: string; anchor: string; tz: string; now: Date; unmatchedNote?: string; resolved?: string }): PlacesDoc {
    const top = opts.places.slice(0, 6)
    const when = new Intl.DateTimeFormat('en-US', { timeZone: opts.tz, weekday: 'short', hour: 'numeric', minute: '2-digit' }).format(opts.now)
    const checked = new Intl.DateTimeFormat('en-CA', { timeZone: opts.tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(opts.now)
    const open = top.filter((p) => p.status.state === 'open')
    const pick = open[0] ?? top[0]
    const lines = [
        pick ? `> Pick: ${pick.name}. ${pick.status.state === 'open' ? pick.status.text : pick.status.text.toLowerCase()}, ${dist(pick)}.` : '',
        '',
        `:::places`,
        ...top.map(placeLine),
        ':::',
        '',
        ':::heads-up',
        `Open or closed is worked out from the hours listed on OpenStreetMap, as of ${when} local time. Those hours are entered by volunteers and can be out of date, so call ahead if timing is tight.`,
        ...(opts.unmatchedNote ? [opts.unmatchedNote] : []),
        ...(opts.resolved ? [`Searched around: ${clean(opts.resolved)}.`] : []),
        'Walk times are straight-line distance plus a street allowance, not a routed estimate. Use the map buttons for live directions.',
        ':::',
        '',
        ':::sources',
        `Venue names, addresses and hours | https://www.openstreetmap.org/copyright | ${checked}`,
        `Search area from the address | https://nominatim.openstreetmap.org | ${checked}`,
        ':::',
    ]
    const text = top.map((p, i) => `${i + 1}. ${p.name} - ${p.status.text}, ${dist(p)}${p.address ? `, ${p.address}` : ''}`).join('\n')
    return {
        title: `${opts.what ? opts.what[0]!.toUpperCase() + opts.what.slice(1) : 'Places'} near ${opts.anchor}`,
        subtitle: `Checked ${when} local time`,
        body: lines.join('\n'),
        text,
    }
}
