/**
 * Weather for the morning brief card, from Open-Meteo (free, no key).
 * Fahrenheit, wind in knots (the card is nautical), plus a first-person
 * "conditions" note only when the day is worth a mention.
 */

import { describeWeatherCode } from '@/lib/tools/weather'

export interface CardWeather {
    place: string
    temp: number
    sky: string
    high: number
    low: number
    wind?: string
    rain?: number
    note?: string
}

const TIMEOUT_MS = 8_000
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']

export function compass(deg: number): string {
    return COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8]
}

async function getJson(url: string, headers?: Record<string, string>): Promise<unknown> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
    try {
        const res = await fetch(url, { signal: controller.signal, headers })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return await res.json()
    } finally {
        clearTimeout(timer)
    }
}

/** Geocode "Miami, FL" style names; the part after the comma picks among hits. */
export async function geocode(name: string): Promise<{ lat: number; lon: number; label: string } | null> {
    const [place, ...rest] = name.split(',').map((s) => s.trim()).filter(Boolean)
    if (!place) return null
    const hint = rest.join(' ').toLowerCase()
    const geo = (await getJson(
        `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(place)}&count=5&language=en&format=json`
    )) as { results?: Array<{ name: string; admin1?: string; country?: string; latitude: number; longitude: number }> }
    const hits = geo.results ?? []
    const hit =
        (hint && hits.find((h) => [h.admin1, h.country].some((v) => v && (v.toLowerCase().includes(hint) || hint.includes(v.toLowerCase()))))) ||
        hits[0]
    return hit ? { lat: hit.latitude, lon: hit.longitude, label: hit.name } : null
}

/** Reverse-geocode coordinates to a short town name (best-effort). */
export async function placeName(lat: number, lon: number): Promise<string | null> {
    try {
        const r = (await getJson(
            `https://nominatim.openstreetmap.org/reverse?format=json&zoom=10&lat=${lat}&lon=${lon}`,
            { 'User-Agent': 'dinghy/1.0 (https://www.getdinghy.sh)' }
        )) as { address?: Record<string, string> }
        const a = r.address ?? {}
        return a.city || a.town || a.village || a.suburb || a.county || null
    } catch {
        return null
    }
}

/** A short first-person note, only when the day calls for one. */
export function conditionsNote(w: { code: number; high: number; rain: number | null }): string | undefined {
    if ([95, 96, 99].includes(w.code)) return "storms in the forecast. I'd keep the afternoon flexible."
    if ((w.rain ?? 0) >= 40) return `${Math.round(w.rain!)}% chance of rain today. I'd grab an umbrella.`
    if (w.high >= 93) return `hot one, high of ${w.high}°. I'd keep water close.`
    if (w.high <= 35) return `cold out, high of ${w.high}°. I'd layer up.`
    return undefined
}

export async function cardWeather(lat: number, lon: number, place: string): Promise<CardWeather | null> {
    const params = new URLSearchParams({
        latitude: String(lat),
        longitude: String(lon),
        current: 'temperature_2m,weather_code,wind_speed_10m,wind_direction_10m',
        daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
        timezone: 'auto',
        forecast_days: '1',
        temperature_unit: 'fahrenheit',
        wind_speed_unit: 'kn',
    })
    try {
        const fc = (await getJson(`https://api.open-meteo.com/v1/forecast?${params}`)) as {
            current?: { temperature_2m: number; weather_code: number; wind_speed_10m: number; wind_direction_10m: number }
            daily?: { weather_code: number[]; temperature_2m_max: number[]; temperature_2m_min: number[]; precipitation_probability_max: (number | null)[] }
        }
        const c = fc.current
        const d = fc.daily
        if (!c || !d) return null
        const high = Math.round(d.temperature_2m_max[0])
        const low = Math.round(d.temperature_2m_min[0])
        const rain = d.precipitation_probability_max?.[0] ?? null
        const dayCode = d.weather_code[0]
        return {
            place: place.toLowerCase(),
            temp: Math.round(c.temperature_2m),
            sky: describeWeatherCode(c.weather_code),
            high,
            low,
            wind: `${compass(c.wind_direction_10m)} ${Math.round(c.wind_speed_10m)} KT`,
            rain: rain ?? undefined,
            note: conditionsNote({ code: dayCode, high, rain }),
        }
    } catch (err) {
        console.error('brief weather failed:', err instanceof Error ? err.message : String(err))
        return null
    }
}
