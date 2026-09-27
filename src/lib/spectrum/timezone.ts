/** Timezone changes come from a person's own signed chat, not a calendar default. */
import { createServerClient } from '@/lib/supabase/server'
import type { LatLon } from './location'

export function parseTimezoneIntent(text: string): string | null {
  const m = text.trim().match(/^(?:i(?: am|'m) (?:now |currently )?in|(?:please )?(?:set|change|switch) my (?:time ?zone|mornings) (?:to|for))\s+([\p{L}\p{N}_/,+. '-]{2,80})[.!?]?$/iu)
  return m ? m[1].trim().replace(/[.!?]+$/, '').trim() : null
}

export function validIanaTimezone(value: string): string | null {
  if (!/^[A-Za-z_]+(?:\/[A-Za-z_+-]+)+$/.test(value)) return null
  try { return new Intl.DateTimeFormat('en-US', { timeZone: value }).resolvedOptions().timeZone }
  catch { return null }
}

export type ZoneChoice = { zone: string; label: string }
export type ZoneResolution = { kind: 'one'; choice: ZoneChoice } | { kind: 'ambiguous'; choices: ZoneChoice[] } | { kind: 'none' }

/** Open-Meteo geocoding returns IANA zones. A place with multiple zones needs a question. */
export async function resolvePlaceTimezone(place: string): Promise<ZoneResolution> {
  const direct = validIanaTimezone(place)
  if (direct) return { kind: 'one', choice: { zone: direct, label: direct.split('/').pop()!.replaceAll('_', ' ') } }
  const [city, ...rest] = place.split(',').map(s => s.trim()).filter(Boolean)
  if (!city || city.length < 2 || !/^[\p{L} .'-]+$/u.test(city)) return { kind: 'none' }
  const countryOrRegion = rest.join(' ').toLowerCase()
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=100&language=en&format=json`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 8000)
  let hits: Array<{ name: string; admin1?: string; country?: string; timezone?: string }>
  try {
    const res = await fetch(url, { signal: controller.signal })
    if (!res.ok) return { kind: 'none' }
    hits = ((await res.json()) as { results?: typeof hits }).results ?? []
  } finally { clearTimeout(timer) }
  const normalized = city.toLocaleLowerCase()
  const matches = hits.filter(h => h.name.toLocaleLowerCase() === normalized && h.timezone)
    .filter(h => !countryOrRegion || [h.admin1, h.country].some(v => v?.toLowerCase() === countryOrRegion || v?.toLowerCase().startsWith(countryOrRegion)))
  const choices: ZoneChoice[] = []
  const seen = new Set<string>()
  for (const hit of matches) {
    const zone = validIanaTimezone(hit.timezone!)
    if (!zone || seen.has(zone)) continue
    seen.add(zone)
    choices.push({ zone, label: [hit.name, hit.admin1, hit.country].filter(Boolean).join(', ') })
  }
  if (choices.length === 1) return { kind: 'one', choice: choices[0] }
  if (choices.length > 1) return { kind: 'ambiguous', choices }
  return { kind: 'none' }
}

/** Resolve a just-shared coordinate against a geo service's IANA zone. */
export async function resolvePinTimezone(loc: LatLon): Promise<string | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 8000)
  try {
    const res = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}&current=temperature_2m&timezone=auto&forecast_days=1`, { signal: controller.signal })
    if (!res.ok) return null
    const data = (await res.json()) as { timezone?: string }
    return validIanaTimezone(data.timezone ?? '')
  } finally { clearTimeout(timer) }
}

/** Read back the persisted value before acknowledging a change. */
export async function setChatTimezone(chatGuid: string, zone: string): Promise<boolean> {
  const db = createServerClient()
  const { data: identity, error: bindingError } = await db.from('spectrum_identities').select('user_id').eq('chat_guid', chatGuid).maybeSingle()
  if (bindingError || !identity?.user_id) return false
  const { data: updated, error } = await db.from('users').update({ timezone: zone }).eq('id', identity.user_id).select('id').maybeSingle()
  if (error || !updated?.id) return false
  const { data: saved } = await db.from('users').select('timezone').eq('id', identity.user_id).maybeSingle()
  return saved?.timezone === zone
}

export function timezoneAck(choice: ZoneChoice): string {
  return `Timezone set to ${choice.label} (${choice.zone}). Morning brief at 8am there.`
}
