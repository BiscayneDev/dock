import { describe, expect, it } from 'vitest'
import { buildDigest, digestFacts, formatDigest, RESEARCH_MARKER, researchEnabled, topPeople, type Signals } from '@/lib/spectrum/connect-research'
import { FIRST_USE_SUGGESTIONS_NO_GOOGLE, GOOGLE_CONNECT_ASK } from '@/lib/spectrum/connect-lines'

const d = (s: string) => new Date(s)
const sig: Signals = {
  from: ['Sam Lee', 'Sam Lee', 'Priya N', 'no-reply', 'Sam Lee', 'a@b.com'],
  to: ['Priya N', 'Priya N', 'Sam Lee', 'Solo Person'],
  events: [
    { summary: 'Weekly sync', start: d('2026-10-06T14:00:00Z'), recurring: true, attendees: [] },
    { summary: 'Weekly sync', start: d('2026-10-13T14:00:00Z'), recurring: true, attendees: [] },
    { summary: 'Dentist', start: d('2026-10-06T18:00:00Z'), recurring: false, attendees: [] },
  ],
}

describe('connect research digest (headers only, nothing guessed)', () => {
  it('ranks repeat correspondents, ignoring bulk, bare addresses and singletons', () => {
    expect(topPeople([...sig.to, ...sig.from], 5).map((p) => p.name)).toEqual(['Priya N', 'Sam Lee'])
  })
  it('summarizes people, events and the busiest day', () => {
    const dg = buildDigest(sig, 'America/New_York')
    expect(dg.recurring).toEqual(['Weekly sync'])
    expect(dg.eventCount).toBe(3)
    const text = formatDigest(dg) as string
    expect(text).toContain('Priya N')
    expect(text).toContain('3 events')
    expect(text).toContain('forget <name>')
    expect(text).not.toMatch(/[*_`#]/)
  })
  it('says nothing when there is nothing real', () => {
    expect(formatDigest(buildDigest({ from: [], to: [], events: [] }, 'UTC'))).toBeNull()
  })
  it('saves short notes plus a marker, capped', () => {
    const f = digestFacts(buildDigest(sig, 'UTC'))
    expect(f.at(-1)?.content).toBe(RESEARCH_MARKER)
    expect(f.length).toBeLessThanOrEqual(9)
    expect(f.every((x) => x.content.length < 120)).toBe(true)
  })
  it('can be turned off', () => {
    process.env.DINGHY_CONNECT_RESEARCH = 'off'
    expect(researchEnabled()).toBe(false)
    delete process.env.DINGHY_CONNECT_RESEARCH
    expect(researchEnabled()).toBe(true)
  })
})

describe('first-reply copy', () => {
  it('Google ask frames connecting as the first step and says what happens', () => {
    expect(GOOGLE_CONNECT_ASK).toContain('first step')
    expect(GOOGLE_CONNECT_ASK).toContain('first look')
    expect(GOOGLE_CONNECT_ASK).not.toMatch(/[*_`#]|can't|cannot/i)
  })
  it('pre-Google tips do not promise email or calendar answers', () => {
    expect(FIRST_USE_SUGGESTIONS_NO_GOOGLE).toContain('once Google is connected')
    expect(FIRST_USE_SUGGESTIONS_NO_GOOGLE).not.toMatch(/what's on my calendar|anything I need to reply/)
    expect(FIRST_USE_SUGGESTIONS_NO_GOOGLE).not.toMatch(/[*_`#]|can't|cannot/i)
  })
})
