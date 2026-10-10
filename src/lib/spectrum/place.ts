/**
 * "Follows the user": where the person is right now, kept apart from their
 * saved home timezone. Home (users.timezone) changes only on an explicit
 * "set my timezone" request. Current place is derived every turn from the
 * best signal and expires on its own, so a trip never rewrites home.
 *
 * Priority: what they said (newest wins) > a fresh shared pin > saved home.
 * Calendar/flight trip signals are a later slice.
 */
import { currentTravelPlace } from './timezone'

export const STATEMENT_FRESH_MS = 36 * 60 * 60 * 1000
export const PIN_FRESH_MS = 15 * 60 * 1000

export type PlaceStatement = { kind: 'at'; place: string } | { kind: 'home' }

/** A direct, present-tense statement of where they are. Null for anything else. */
export function placeStatement(text: string): PlaceStatement | null {
  const clean = text.trim().replace(/[’]/g, "'")
  if (!clean || /["“”]/.test(clean)) return null
  const first = clean.split(/[.!](?:\s|$)/, 1)[0].trim().replace(/\s+(?:now|today|tonight)$/i, '')
  if (first.includes('?')) return null
  if (/^(?:i(?:'m| am) )?(?:back home|home now|home again)\b/i.test(first) || /^i(?:'m| am) (?:now )?home\b/i.test(first)) return { kind: 'home' }
  if (/\b(?:i was|i will|i'll|i'm going|i am going|i'm gonna|going to be|will be|if i)\b/i.test(first)) return null
  const trip = currentTravelPlace(first)
  if (trip) return { kind: 'at', place: trip }
  const m = first.match(/^(?:i(?:'m| am) (?:now |currently |just )?in|(?:i )?(?:just )?(?:landed|arrived|got) (?:in|to)|(?:i'm|i am) (?:now )?(?:landing|arriving) in)\s+([\p{L} .'-]{2,40}?)(?:,\s*([\p{L} .'-]{2,30}))?(?:\s+(?:now|today|tonight|for (?:the )?(?:week|weekend|work|a few days).*))?$/iu)
  if (!m) return null
  const place = [m[1], m[2]].filter(Boolean).join(', ').trim()
  if (place.split(/\s+/).length > 4) return null
  return { kind: 'at', place }
}

/** Only a standalone update gets an early ack; never swallow a later ask. */
export function isPlaceOnlyMessage(text: string): boolean {
  const clean = text.trim().replace(/[’]/g, "'").replace(/[.!]$/, '')
  return !/[.!?]/.test(clean) && /^(?:i(?:'m| am) |(?:i )?(?:just )?(?:landed|arrived|got) |back home$|home now$|home again$)/i.test(clean) && placeStatement(clean) !== null
}

export type StatedMessage = { content: string; created_at: string }

/** Newest statement wins; a statement older than 36h has expired. */
export function latestStatement(userMessages: StatedMessage[], now: number): (PlaceStatement & { at: number }) | null {
  const sorted = [...userMessages].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
  for (const m of sorted) {
    const at = Date.parse(m.created_at)
    if (!Number.isFinite(at) || at > now) continue
    if (now - at >= STATEMENT_FRESH_MS) return null
    const s = placeStatement(m.content)
    if (s) return { ...s, at }
  }
  return null
}

export type CurrentPlace = {
  zone: string
  source: 'statement' | 'pin' | 'home'
  label: string
  home: string
}

/** Pick the clock zone. `statedZone`/`pin` are already resolved to IANA zones. */
export function chooseCurrentPlace(input: {
  home: string
  stated?: { zone: string; label: string } | { home: true } | null
  pin?: { zone: string; label: string; observedAt: number } | null
  now: number
}): CurrentPlace {
  const { home, stated, pin, now } = input
  if (stated && 'zone' in stated) return { zone: stated.zone, source: 'statement', label: stated.label, home }
  if (stated && 'home' in stated) return { zone: home, source: 'home', label: 'home', home }
  if (pin && Number.isFinite(pin.observedAt) && now >= pin.observedAt && now - pin.observedAt < PIN_FRESH_MS) return { zone: pin.zone, source: 'pin', label: pin.label, home }
  return { zone: home, source: 'home', label: 'home', home }
}

export function travelAck(label: string, homeZone: string): string {
  return `Got it. I'll use ${label} time for this chat for up to 36 hours, unless you tell me you've moved. Your home stays ${homeZone.split('/').pop()!.replaceAll('_', ' ')}. Say "back home" when you're back.`
}
