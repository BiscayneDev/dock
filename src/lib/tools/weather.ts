import type { Tool, ToolResult } from '@/lib/llm/types'

/**
 * Live weather from Open-Meteo (free, no API key). Geocodes a place name,
 * then reads current conditions plus a short daily forecast.
 */

const WMO: Record<number, string> = {
    0: 'clear', 1: 'mostly clear', 2: 'partly cloudy', 3: 'overcast',
    45: 'fog', 48: 'freezing fog',
    51: 'light drizzle', 53: 'drizzle', 55: 'heavy drizzle', 56: 'freezing drizzle', 57: 'freezing drizzle',
    61: 'light rain', 63: 'rain', 65: 'heavy rain', 66: 'freezing rain', 67: 'freezing rain',
    71: 'light snow', 73: 'snow', 75: 'heavy snow', 77: 'snow grains',
    80: 'light showers', 81: 'showers', 82: 'heavy showers', 85: 'snow showers', 86: 'heavy snow showers',
    95: 'thunderstorms', 96: 'thunderstorms with hail', 99: 'thunderstorms with hail',
}

export function describeWeatherCode(code: number | null | undefined): string {
    if (code == null) return 'unknown'
    return WMO[code] ?? 'unknown'
}

const TIMEOUT_MS = 8_000

async function getJson(url: string): Promise<unknown> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
    try {
        const res = await fetch(url, { signal: controller.signal })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return await res.json()
    } finally {
        clearTimeout(timer)
    }
}

interface GeoHit { name: string; admin1?: string; country?: string; latitude: number; longitude: number; timezone?: string }

export const weather: Tool = {
    name: 'weather',
    description:
        'Current weather and the next few days of forecast for a place (city, town, or "city, state"). ' +
        'Use this for any weather, temperature, rain or forecast question instead of guessing.',
    inputSchema: {
        type: 'object',
        properties: {
            location: { type: 'string', description: 'Place name, e.g. "Miami" or "Austin, TX"' },
            days: { type: 'number', description: 'Forecast days, 1-7 (default 3)' },
            units: { type: 'string', enum: ['fahrenheit', 'celsius'], description: 'Default fahrenheit' },
        },
        required: ['location'],
    },
    async execute(input: unknown): Promise<ToolResult> {
        const args = (input ?? {}) as { location?: unknown; days?: unknown; units?: unknown }
        const location = typeof args.location === 'string' ? args.location.trim() : ''
        if (!location) return { success: false, error: 'location is required' }
        const days = Math.min(7, Math.max(1, Math.round(Number(args.days) || 3)))
        const celsius = args.units === 'celsius'

        try {
            // Open-Meteo geocoding matches on the place name only, so search
            // the part before the first comma and use the rest to pick a hit.
            const [place, ...rest] = location.split(',').map((s) => s.trim()).filter(Boolean)
            const hint = rest.join(' ').toLowerCase()
            const geo = (await getJson(
                `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(place ?? location)}&count=5&language=en&format=json`
            )) as { results?: GeoHit[] }
            const hits = geo.results ?? []
            if (hits.length === 0) return { success: false, error: `couldn't find a place called "${location}"` }
            const hit =
                (hint &&
                    hits.find((h) =>
                        [h.admin1, h.country].some((v) => v && (v.toLowerCase().includes(hint) || hint.includes(v.toLowerCase())))
                    )) ||
                hits[0]

            const params = new URLSearchParams({
                latitude: String(hit.latitude),
                longitude: String(hit.longitude),
                current: 'temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m',
                daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
                timezone: 'auto',
                forecast_days: String(days),
                temperature_unit: celsius ? 'celsius' : 'fahrenheit',
                wind_speed_unit: celsius ? 'kmh' : 'mph',
            })
            const fc = (await getJson(`https://api.open-meteo.com/v1/forecast?${params}`)) as {
                timezone?: string
                current?: { time: string; temperature_2m: number; apparent_temperature: number; relative_humidity_2m: number; weather_code: number; wind_speed_10m: number }
                daily?: { time: string[]; weather_code: number[]; temperature_2m_max: number[]; temperature_2m_min: number[]; precipitation_probability_max: (number | null)[] }
            }
            const c = fc.current
            const d = fc.daily
            return {
                success: true,
                data: {
                    place: [hit.name, hit.admin1, hit.country].filter(Boolean).join(', '),
                    timezone: fc.timezone ?? hit.timezone ?? null,
                    units: celsius ? 'C, km/h' : 'F, mph',
                    now: c
                        ? {
                              as_of_local: c.time,
                              temp: Math.round(c.temperature_2m),
                              feels_like: Math.round(c.apparent_temperature),
                              humidity_pct: c.relative_humidity_2m,
                              wind: Math.round(c.wind_speed_10m),
                              conditions: describeWeatherCode(c.weather_code),
                          }
                        : null,
                    forecast: (d?.time ?? []).map((date, i) => ({
                        date,
                        high: Math.round(d!.temperature_2m_max[i]),
                        low: Math.round(d!.temperature_2m_min[i]),
                        rain_chance_pct: d!.precipitation_probability_max?.[i] ?? null,
                        conditions: describeWeatherCode(d!.weather_code[i]),
                    })),
                },
            }
        } catch (err) {
            const msg = err instanceof Error ? (err.name === 'AbortError' ? 'timed out' : err.message) : String(err)
            return { success: false, error: `weather lookup failed: ${msg}` }
        }
    },
}
