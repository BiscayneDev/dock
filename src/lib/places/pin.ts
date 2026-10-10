import { createServerClient } from '@/lib/supabase/server'

/**
 * The location pin the user shared in chat (user_locations), if it is fresh
 * (24h). Never the home place and never a geocode: coordinates the user gave us.
 */
export async function freshPin(userId: string, now = Date.now()): Promise<{ lat: number; lon: number; label: string | null } | null> {
    try {
        const { data } = await createServerClient().from('user_locations').select('lat, lon, label, observed_at').eq('user_id', userId).maybeSingle()
        if (!data || now - new Date(data.observed_at as string).getTime() > 24 * 60 * 60 * 1000) return null
        const lat = Number(data.lat), lon = Number(data.lon)
        return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon, label: (data.label as string | null) ?? null } : null
    } catch {
        return null
    }
}

/** ~110 m grid (3 decimals). A shared pin is rounded before it goes to a public map server. */
export const roundCoord = (n: number): number => Math.round(n * 1000) / 1000
