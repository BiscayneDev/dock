/**
 * Free place data: OpenStreetMap Nominatim (geocode) + Overpass (nearby venues).
 * No paid vendor, no key. Community-entered data, so hours can be missing or
 * stale; callers show that honestly.
 *
 * Scale path: the public OSM servers are for low volume. For more, self-host
 * Nominatim, Photon and Overpass (or use a hosted mirror) and point
 * PLACES_NOMINATIM_URL, PLACES_PHOTON_URL and PLACES_OVERPASS_URL at them; the
 * shared limiter then stops applying to those hosts and street addresses may be
 * geocoded because they no longer leave our infrastructure.
 *
 * Public-server etiquette (OSM usage policy): identifying User-Agent, short
 * timeouts, a 24h durable cache of geocodes (so a repeat anchor makes zero
 * geocode calls), and a database-backed budget of 1 request/second per public host
 * across ALL users and instances (claim_places_slot). When the budget is not
 * available we send nothing (BudgetUnavailable) instead of bursting. Worst case per lookup is 4 external calls: Nominatim, then
 * Photon only if Nominatim finds nothing, then Overpass, then one mirror only
 * if Overpass fails. Typical (cached anchor) is 1.
 */
import { createHash } from 'crypto'
import tzlookup from './vendor/tz-lookup'
import { openStatus, type OpenStatus } from './hours'

const UA = 'Dinghy/1.0 (https://www.getdinghy.sh; personal assistant place lookup)'
const TIMEOUT_MS = 9000

/** Thrown when the shared request budget for a host is not available. Callers never send anyway. */
export class BudgetUnavailable extends Error {
    constructor(host: string) { super(`places request budget unavailable for ${host}`) }
}

/** The longest a lookup will wait for its slot. Past this the budget is treated as unavailable. */
const MAX_WAIT_MS = 4000
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/**
 * Shared budget: 1 request per second per host in TOTAL across all users and
 * server instances (Nominatim policy), claimed atomically in the database
 * (claim_places_slot). Fails closed: if the claim cannot be made or the wait
 * is too long, throw BudgetUnavailable and send nothing. Hosts that are
 * self-hosted (env override) are not rate limited here.
 */
export async function politely(host: string, gapMs = 1000): Promise<void> {
    let wait: number
    try {
        const { data, error } = await createServerClient().rpc('claim_places_slot', { p_host: host, p_gap_ms: gapMs, p_max_wait_ms: MAX_WAIT_MS })
        if (error || typeof data !== 'number') throw new BudgetUnavailable(host)
        wait = data
    } catch {
        throw new BudgetUnavailable(host)
    }
    if (wait < 0) throw new BudgetUnavailable(host)
    if (wait > 0) await sleep(wait)
}

/** Endpoints are configurable so a self-hosted mirror can replace the public servers (see docs below). */
const env = (k: string, d: string): string => (process.env[k] || d).replace(/\/+$/, '')
export const endpoints = () => ({
    nominatim: env('PLACES_NOMINATIM_URL', 'https://nominatim.openstreetmap.org'),
    photon: env('PLACES_PHOTON_URL', 'https://photon.komoot.io'),
    overpass: env('PLACES_OVERPASS_URL', 'https://overpass-api.de/api/interpreter'),
})
const PUBLIC_HOSTS = new Set(['nominatim.openstreetmap.org', 'photon.komoot.io', 'overpass-api.de', 'overpass.kumi.systems'])
const isPublic = (url: string): boolean => { try { return PUBLIC_HOSTS.has(new URL(url).host) } catch { return true } }
/**
 * True only when EVERY geocoder in the chain is explicitly private: the operator
 * set PLACES_GEOCODER_PRIVATE=1 and both PLACES_NOMINATIM_URL and
 * PLACES_PHOTON_URL point off the public hosts. A missing Photon URL means the
 * chain still contains a public host, so it is not private. Street addresses
 * are additionally refused by each public geocoder call itself (defence in depth).
 */
export const geocoderIsPrivate = (): boolean =>
    process.env.PLACES_GEOCODER_PRIVATE === '1' &&
    Boolean(process.env.PLACES_NOMINATIM_URL) && Boolean(process.env.PLACES_PHOTON_URL) &&
    !isPublic(endpoints().nominatim) && !isPublic(endpoints().photon)
/** Only the public servers share the budget; a self-hosted mirror is ours to load. */
export const limit = async (url: string): Promise<void> => { if (isPublic(url)) await politely(new URL(url).host) }

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
    chain: boolean
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
    const base = endpoints().photon
    // Never send a street address to a public host, whatever the caller did.
    if (looksLikeStreetAddress(query) && isPublic(base)) return null
    await limit(base)
    const res = await fetch(`${base}/api/?limit=1&q=${encodeURIComponent(query)}`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (!res.ok) return null
    const f = ((await res.json()) as { features?: { properties?: Record<string, string>; geometry?: { coordinates?: number[] } }[] }).features?.[0]
    const c = f?.geometry?.coordinates
    if (!f || !c || c.length < 2) return null
    const pr = f.properties ?? {}
    return { lat: Number(c[1]), lon: Number(c[0]), label: [pr.name, pr.street, pr.city, pr.country].filter(Boolean).join(', ') }
}

/** Nominatim is exact; Photon (also OpenStreetMap data, free) forgives names like "Parkroyal on Pickering". */
import { createServerClient } from '@/lib/supabase/server'

const CACHE_TTL_MS = 24 * 60 * 60 * 1000
const normalise = (q: string): string => q.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 200)
/** Cache key is a hash, never the text. */
export const cacheKey = (q: string): string => createHash('sha256').update(normalise(q)).digest('hex')
/** A house or street address is likely private (home, work): look it up live, never cache it. */
export const looksLikeStreetAddress = (q: string): boolean =>
    /^\s*(?:#?\d+[a-z]?[\s,-]+\w)/i.test(q) || /\b\d{1,6}[a-z]?\s+[\p{L}.' -]{2,40}\b(street|st|avenue|ave|road|rd|drive|dr|lane|ln|blvd|boulevard|way|court|ct|place|pl|strasse|rue)\b/iu.test(q)

/** Cached geocode: 24h durable cache, then the live servers. Cache failures never block a lookup. */
export async function geocodeCached(query: string): Promise<{ lat: number; lon: number; label: string } | null> {
    if (looksLikeStreetAddress(query)) return geocode(query)
    const key = cacheKey(query)
    try {
        const { data } = await createServerClient().from('place_geocode_cache').select('lat,lon,label,created_at').eq('key', key).maybeSingle()
        if (data && Date.now() - new Date(data.created_at as string).getTime() < CACHE_TTL_MS) return { lat: data.lat as number, lon: data.lon as number, label: data.label as string }
    } catch { /* cache is best-effort */ }
    const hit = await geocode(query)
    if (hit) {
        try {
            const db = createServerClient()
            await db.from('place_geocode_cache').upsert({ key, lat: hit.lat, lon: hit.lon, label: hit.label, created_at: new Date().toISOString() })
            // On-write purge: nothing older than the TTL is kept.
            await db.from('place_geocode_cache').delete().lt('created_at', new Date(Date.now() - CACHE_TTL_MS).toISOString())
        } catch { /* ignore */ }
    }
    return hit
}

export async function geocode(query: string): Promise<{ lat: number; lon: number; label: string } | null> {
    const budget = (e: unknown): void => { if (e instanceof BudgetUnavailable) throw e }
    const exact = await nominatim(query).catch((e) => { budget(e); return null })
    return exact ?? (await photon(query).catch((e) => { budget(e); return null }))
}

async function nominatim(query: string): Promise<{ lat: number; lon: number; label: string } | null> {
    const base = endpoints().nominatim
    if (looksLikeStreetAddress(query) && isPublic(base)) return null
    const url = `${base}/search?format=jsonv2&limit=1&q=${encodeURIComponent(query)}`
    await limit(base)
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

/** Cuisine tag hits count double: a place tagged for the food beats one that only has it in its name. */
export function matchScore(tags: Tags, words: string[]): number {
    if (!words.length) return 1
    const cuisine = (tags.cuisine ?? '').toLowerCase().replace(/_/g, ' ')
    const named = `${tags.name ?? ''} ${tags['name:en'] ?? ''} ${tags.description ?? ''}`.toLowerCase()
    return words.reduce((n, w) => n + (cuisine.includes(w) ? 2 : named.includes(w) ? 1 : 0), 0)
}
/** A branded fast-food outlet (KFC, Burger King). Shown only when nothing better matches. */
export const isChain = (tags: Tags): boolean => tags.amenity === 'fast_food' && Boolean(tags.brand || tags['brand:wikidata'])
export const matchesWhat = (tags: Tags, words: string[]): boolean => matchScore(tags, words) > 0

const addressOf = (t: Tags): string => {
    const street = [t['addr:housenumber'], t['addr:street']].filter(Boolean).join(' ')
    return [street, t['addr:unit'], t['addr:city'] ?? t['addr:suburb'], t['addr:postcode']].filter(Boolean).join(', ')
}

const https = (u?: string): string | undefined => (u && /^https?:\/\/[^\s\u0000-\u001f]+$/i.test(u) ? u : undefined)

export function toPlaces(els: El[], origin: { lat: number; lon: number }, words: string[], now: Date, tz: string, tzUntrusted = false): Place[] {
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
            status: tzUntrusted ? { state: 'unknown', text: 'Hours not listed' } : openStatus(t.opening_hours, now, tz),
            matched: matchesWhat(t, words),
            score: matchScore(t, words),
            chain: isChain(t),
        })
    }
    // Matches first, then open ones, then nearest.
    const rank = (p: Place) => (p.matched ? 0 : 4) + (p.status.state === 'open' ? 0 : p.status.state === 'unknown' ? 1 : 2)
    return out.sort((a, b) => Number(a.chain) - Number(b.chain) || b.score - a.score || rank(a) - rank(b) || a.distanceM - b.distanceM)
}


export async function nearbyEateries(origin: { lat: number; lon: number }, radiusM: number): Promise<El[]> {
    const q = `[out:json][timeout:12];nwr(around:${radiusM},${origin.lat},${origin.lon})["amenity"~"^(restaurant|cafe|fast_food|food_court|bar|pub|ice_cream)$"]["name"];out center tags 150;`
    let last: unknown
    const configured = process.env.PLACES_OVERPASS_URL
    for (const url of configured ? [endpoints().overpass] : [endpoints().overpass, 'https://overpass.kumi.systems/api/interpreter']) {
        try {
            await limit(url)
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' },
                body: `data=${encodeURIComponent(q)}`,
                signal: AbortSignal.timeout(TIMEOUT_MS + 4000),
            })
            if (!res.ok) throw new Error(`overpass ${res.status}`)
            return ((await res.json()) as { elements?: El[] }).elements ?? []
        } catch (err) {
            if (err instanceof BudgetUnavailable) throw err
            last = err
        }
    }
    throw last instanceof Error ? last : new Error('overpass failed')
}

/** IANA zone for a coordinate (offline lookup), or null if it cannot be trusted. */
export function zoneAt(lat: number, lon: number): string | null {
    try {
        const z = tzlookup(lat, lon)
        return z && /^[A-Za-z_]+\/[A-Za-z_\-/]+$|^UTC$/.test(z) ? z : null
    } catch {
        return null
    }
}

const norm = (t: string): string[] => t.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter((w) => w.length > 2 && !['the', 'and', 'hotel', 'near', 'around'].includes(w))

/**
 * Did the geocoder find what was asked? True when most meaningful words of the
 * anchor appear in the resolved label. Low overlap means a different place or
 * city may have been picked, so the page and reply say what was searched.
 */
export function anchorConfident(anchor: string, label: string): boolean {
    const a = norm(anchor)
    if (!a.length) return false
    const l = norm(label).join(' ')
    return a.filter((w) => l.includes(w)).length / a.length >= 0.6
}
