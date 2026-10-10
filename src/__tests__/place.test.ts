import { describe, expect, it } from 'vitest'
import { chooseCurrentPlace, isPlaceOnlyMessage, latestStatement, placeStatement } from '@/lib/spectrum/place'
import { localClockContext, parseHomeTimezoneIntent } from '@/lib/spectrum/timezone'

const NOW = Date.parse('2026-10-10T12:00:00Z')
const ago = (h: number) => new Date(NOW - h * 3600_000).toISOString()

describe('placeStatement', () => {
  it('reads present-tense location statements', () => {
    expect(placeStatement("I'm in Singapore")).toEqual({ kind: 'at', place: 'Singapore' })
    expect(placeStatement('just landed in Tokyo')).toEqual({ kind: 'at', place: 'Tokyo' })
    expect(placeStatement("I'm in Austin, Texas now")).toEqual({ kind: 'at', place: 'Austin, Texas' })
    expect(placeStatement("I'm on a work trip in Lisbon")).toEqual({ kind: 'at', place: 'Lisbon' })
    expect(placeStatement("I'm back home")).toEqual({ kind: 'home' })
    expect(placeStatement("I'm in Singapore. Where can I eat?")).toEqual({ kind: 'at', place: 'Singapore' })
    expect(isPlaceOnlyMessage("I'm in Singapore. Where can I eat?")).toBe(false)
    expect(isPlaceOnlyMessage("I'm in Singapore.")).toBe(true)
  })
  it('ignores plans, past, questions, quotes and long phrases', () => {
    expect(placeStatement("I'm going to be in Paris")).toBeNull()
    expect(placeStatement('I was in Rome last week')).toBeNull()
    expect(placeStatement('Am I in Paris?')).toBeNull()
    expect(placeStatement('Sam said "I am in Paris"')).toBeNull()
    expect(placeStatement("I'm in a meeting with the board of directors today")).toBeNull()
  })
})

describe('latestStatement', () => {
  it('newest wins and 36h expires', () => {
    expect(latestStatement([{ content: "I'm in Tokyo", created_at: ago(30) }, { content: "I'm back home", created_at: ago(2) }], NOW)).toMatchObject({ kind: 'home' })
    expect(latestStatement([{ content: "I'm in Tokyo", created_at: ago(40) }], NOW)).toBeNull()
    expect(latestStatement([{ content: 'hello', created_at: ago(1) }, { content: "I'm in Tokyo", created_at: ago(5) }], NOW)).toMatchObject({ kind: 'at', place: 'Tokyo' })
  })
})

describe('chooseCurrentPlace', () => {
  const home = 'Europe/Paris'
  const sg = { zone: 'Asia/Singapore', label: 'Singapore' }
  it('statement beats pin beats home', () => {
    const pin = { zone: 'Asia/Tokyo', label: 'Tokyo', observedAt: NOW - 10 * 60_000 }
    expect(chooseCurrentPlace({ home, stated: sg, pin, now: NOW })).toMatchObject({ zone: 'Asia/Singapore', source: 'statement' })
    expect(chooseCurrentPlace({ home, pin, now: NOW })).toMatchObject({ zone: 'Asia/Tokyo', source: 'pin' })
    expect(chooseCurrentPlace({ home, stated: { home: true }, pin, now: NOW })).toMatchObject({ zone: home, source: 'home' })
    expect(chooseCurrentPlace({ home, pin: { ...pin, observedAt: NOW - 15 * 60_000 }, now: NOW })).toMatchObject({ zone: home, source: 'home' })
    expect(chooseCurrentPlace({ home, pin: { ...pin, observedAt: NOW + 1 }, now: NOW })).toMatchObject({ zone: home, source: 'home' })
  })
})

describe('clock + home intent', () => {
  it('shows home time when away and leaves home alone', () => {
    const c = localClockContext('Asia/Singapore', new Date(NOW), { home: 'Europe/Paris', label: 'Singapore', source: 'statement' })
    expect(c).toContain('away from home')
    expect(c).toContain('Europe/Paris')
    expect(c).toContain('Timezone: Asia/Singapore')
  })
  it('only explicit requests change home', () => {
    expect(parseHomeTimezoneIntent("I'm in Singapore")).toBeNull()
    expect(parseHomeTimezoneIntent('set my timezone to Europe/Paris')).toBe('Europe/Paris')
    expect(parseHomeTimezoneIntent("Nope, I'm back in nyc")).toBe('nyc')
  })
})
