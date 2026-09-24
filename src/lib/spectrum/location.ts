/**
 * Where the person is, for the morning brief's weather.
 *
 * Dinghy can't read a phone's GPS on its own. It uses the last location the
 * person shared into the thread (iMessage "Send My Current Location" arrives
 * as a .loc.vcf with a maps.apple.com link; a pasted Apple/Google Maps link
 * works too) while it's fresh, then falls back to briefing_settings.home_place.
 */

import { createServerClient } from '@/lib/supabase/server'
import { geocode, placeName } from '@/lib/weather/brief-weather'

/** A shared pin counts as "where they are" for this long. */
export const LOCATION_FRESH_MS = 24 * 60 * 60 * 1000

export interface LatLon { lat: number; lon: number; label?: string }

function valid(lat: number, lon: number): boolean {
    return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && !(lat === 0 && lon === 0)
}

/** Pull coordinates out of a maps link or a location vCard body. */
export function parseLocation(text: string): LatLon | null {
    const patterns = [
        /maps\.apple\.com\/[^\s"]*?[?&](?:ll|q|sll)=(-?\d+(?:\.\d+)?)(?:,|%2C)(-?\d+(?:\.\d+)?)/i,
        /google\.[a-z.]+\/maps[^\s"]*?@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/i,
        /google\.[a-z.]+\/maps[^\s"]*?[?&](?:q|query|ll)=(-?\d+(?:\.\d+)?)(?:,|%2C)(-?\d+(?:\.\d+)?)/i,
        /\bgeo:(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/i,
    ]
    for (const re of patterns) {
        const m = text.match(re)
        if (m) {
            const lat = Number(m[1])
            const lon = Number(m[2])
            if (valid(lat, lon)) return { lat, lon }
        }
    }
    return null
}

/** Is this attachment a shared location card? */
export function isLocationAttachment(name: string, mimeType: string): boolean {
    return /\.loc\.vcf$/i.test(name) || (/vcard/i.test(mimeType) && /loc/i.test(name))
}

export async function saveUserLocation(userId: string, loc: LatLon, source = 'imessage_pin'): Promise<boolean> {
    const supabase = createServerClient()
    const label = loc.label ?? (await placeName(loc.lat, loc.lon)) ?? null
    const { error } = await supabase
        .from('user_locations')
        .upsert({ user_id: userId, lat: loc.lat, lon: loc.lon, label, source, observed_at: new Date().toISOString() })
    if (error) {
        console.error('user location save failed:', error.message)
        return false
    }
    return true
}

/** Fresh shared pin first, then the home place, else null (card skips weather). */
export async function briefLocation(userId: string, now = Date.now()): Promise<(LatLon & { label: string; source: 'pin' | 'home' }) | null> {
    const supabase = createServerClient()
    const { data: pin } = await supabase
        .from('user_locations')
        .select('lat, lon, label, observed_at')
        .eq('user_id', userId)
        .maybeSingle()
    if (pin && now - new Date(pin.observed_at as string).getTime() < LOCATION_FRESH_MS) {
        const lat = Number(pin.lat)
        const lon = Number(pin.lon)
        const label = (pin.label as string | null) ?? (await placeName(lat, lon)) ?? 'here'
        return { lat, lon, label, source: 'pin' }
    }
    const { data: settings } = await supabase.from('briefing_settings').select('home_place').eq('user_id', userId).maybeSingle()
    const home = (settings?.home_place as string | null)?.trim()
    if (!home) return null
    const hit = await geocode(home).catch(() => null)
    return hit ? { lat: hit.lat, lon: hit.lon, label: hit.label, source: 'home' } : null
}
