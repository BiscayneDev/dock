/**
 * Free place data: OpenStreetMap Nominatim (geocode) + Overpass (nearby venues).
 * No paid vendor, no key. Community-entered data, so hours can be missing or
 * stale; callers show that honestly. Public servers: one geocode and one
 * Overpass call per lookup, identifying User-Agent, short timeouts.
 */
import { openStatus, type OpenStatus } from './hours'

const UA = 'Dinghy/1.0 (https://www.getdinghy.sh; personal assistant place lookup)'
const TIMEOUT_MS = 9000

export interface Place {
    name: string
    lat: number
    lon: number
    distanceM: number
    walkMin: number
    address: string
    hours?: string
    phone?: string
    website?: string
    cuisine?: string
    kind: string
    osmUrl: string
    status: OpenStatus
    matched: boolean
    score: number
}

export function haversineM(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
    const R = 6371000, rad = Math.PI / 180
    const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2
    return 2 * R * Math.asin(Math.sqrt(h))
}

/** Street distance is about 1.3x straight line; walking is about 80 m a minute. */
export const walkMinutes = (m: number): number => Math.max(1, Math.round((m * 1.3) / 80))

async function photon(query: string): Promise<{ lat: number; lon: number; label: string } | null> {
    const res = await fetch(`https://photon.komoot.io/api/?limit=1&q=${encodeURIComponent(query)}`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (!res.ok) return null
    const f = ((await res.json()) as { features?: { properties?: Record<string, string>; geometry?: { coordinates?: number[] } }[] }).features?.[0]
    const c = f?.geometry?.coordinates
    if (!f || !c || c.length < 2) return null
    const pr = f.properties ?? {}
    return { lat: Number(c[1]), lon: Number(c[0]), label: [pr.name, pr.street, pr.city, pr.country].filter(Boolean).join(', ') }
}

/** Nominatim is exact; Photon (also OpenStreetMap data, free) forgives names like "Parkroyal on Pickering". */
export async function geocode(query: string): Promise<{ lat: number; lon: number; label: string } | null> {
    const exact = await nominatim(query).catch(() => null)
    return exact ?? (await photon(query).catch(() => null))
}

async function nominatim(query: string): Promise<{ lat: number; lon: number; label: string } | null> {
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(query)}`
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (!res.ok) throw new Error(`geocode ${res.status}`)
    const rows = (await res.json()) as { lat: string; lon: string; display_name: string }[]
    const r = rows[0]
    if (!r) return null
    return { lat: Number(r.lat), lon: Number(r.lon), label: r.display_name }
}

type Tags = Record<string, string>
interface El { type: string; id: number; lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Tags }

const STOP = new Set(['a', 'an', 'the', 'and', 'or', 'good', 'best', 'nice', 'place', 'places', 'restaurant', 'restaurants', 'food', 'near', 'me', 'some'])
export const keywords = (what: string): string[] => what.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOP.has(w))

export function matchScore(tags: Tags, words: string[]): number {
    if (!words.length) return 1
    const hay = `${tags.name ?? ''} ${tags['name:en'] ?? ''} ${tags.cuisine ?? ''} ${tags.description ?? ''}`.toLowerCase().replace(/_/g, ' ')
    return words.filter((w) => hay.includes(w)).length
}
export const matchesWhat = (tags: Tags, words: string[]): boolean => matchScore(tags, words) > 0

const addressOf = (t: Tags): string => {
    const street = [t['addr:housenumber'], t['addr:street']].filter(Boolean).join(' ')
    return [street, t['addr:unit'], t['addr:city'] ?? t['addr:suburb'], t['addr:postcode']].filter(Boolean).join(', ')
}

const https = (u?: string): string | undefined => (u && /^https?:\/\/[^\s\u0000-\u001f]+$/i.test(u) ? u : undefined)

export function toPlaces(els: El[], origin: { lat: number; lon: number }, words: string[], now: Date, tz: string): Place[] {
    const out: Place[] = []
    for (const e of els) {
        const t = e.tags
        const lat = e.lat ?? e.center?.lat, lon = e.lon ?? e.center?.lon
        if (!t?.name || lat === undefined || lon === undefined) continue
        const distanceM = Math.round(haversineM(origin, { lat, lon }))
        out.push({
            name: t.name.replace(/\|/g, '/'),
            lat, lon, distanceM, walkMin: walkMinutes(distanceM),
            address: addressOf(t),
            hours: t.opening_hours,
            phone: t.phone ?? t['contact:phone'],
            website: https(t.website ?? t['contact:website']),
            cuisine: t.cuisine?.replace(/_/g, ' ').replace(/;/g, ', '),
            kind: (t.amenity ?? 'place').replace(/_/g, ' '),
            osmUrl: `https://www.openstreetmap.org/${e.type}/${e.id}`,
            status: openStatus(t.opening_hours, now, tz),
            matched: matchesWhat(t, words),
            score: matchScore(t, words),
        })
    }
    // Matches first, then open ones, then nearest.
    const rank = (p: Place) => (p.matched ? 0 : 4) + (p.status.state === 'open' ? 0 : p.status.state === 'unknown' ? 1 : 2)
    return out.sort((a, b) => b.score - a.score || rank(a) - rank(b) || a.distanceM - b.distanceM)
}

export async function nearbyEateries(origin: { lat: number; lon: number }, radiusM: number): Promise<El[]> {
    const q = `[out:json][timeout:12];nwr(around:${radiusM},${origin.lat},${origin.lon})["amenity"~"^(restaurant|cafe|fast_food|food_court|bar|pub|ice_cream)$"]["name"];out center tags 150;`
    const res = await fetch('https://overpass-api.de/api/interpreter', {
        method: 'POST',
        headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(q)}`,
        signal: AbortSignal.timeout(TIMEOUT_MS + 4000),
    })
    if (!res.ok) throw new Error(`overpass ${res.status}`)
    return ((await res.json()) as { elements?: El[] }).elements ?? []
}
