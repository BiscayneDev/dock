import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { currentTravelPlace, localClockContext, parseTimezoneIntent } from '@/lib/spectrum/timezone'
import { findingIsUpcoming, formatFirstFinding } from '@/lib/spectrum/first-finding'
const now = new Date('2026-10-10T11:23:35Z')
describe('travel corrections', () => {
  it('recognizes the actual explicit timezone correction with curly apostrophe and more sentences', () => {
    expect(parseTimezoneIntent('Please remember I’m on a Singapore timezone. I don’t have a flight at 6:25 to Miami today')).toBe('Singapore')
    expect(parseTimezoneIntent("please note that I'm in the Asia/Singapore timezone.")).toBe('Asia/Singapore')
  })
  it('uses an own current work-trip statement, not a quoted, future or past trip', () => {
    expect(currentTravelPlace('No that was an old trip - my fiance Pia is there while I’m on the work trip in Singapore')).toBe('Singapore')
    expect(currentTravelPlace("I'm on a work trip in Singapore.")).toBe('Singapore')
    expect(currentTravelPlace("Sam said \"I'm on a work trip in Singapore\"")).toBeNull()
    expect(currentTravelPlace('I was on a work trip in Singapore')).toBeNull()
    expect(currentTravelPlace("I'm going on a work trip in Singapore")).toBeNull()
    expect(parseTimezoneIntent('No that was an old trip - my fiance Pia is there while I’m on the work trip in Singapore')).toBeNull()
  })
  it('gives a calculated local date/time and UTC anchor, not a recalled day', () => {
    const block = localClockContext('Asia/Singapore', now)
    expect(block).toContain('Saturday, 10 October 2026'); expect(block).toContain('19:23:35')
    expect(block).toContain('Asia/Singapore'); expect(block).toContain(now.toISOString())
    expect(block).toContain('Verify the same departure place, date and flight')
    expect(block).toContain('Never use your earlier reply as proof')
  })
  it('passes the clock into both chat paths and leaves travel as turn-only context', () => {
    const handler = readFileSync('src/lib/spectrum/handler.ts', 'utf8')
    expect(handler).toContain('toolCtx.timezone = travelZone.choice.zone')
    expect(handler.match(/\+ clock,/g)).toHaveLength(2)
    expect(handler).toContain('const clock = localClockContext')
  })
})
describe('fresh first-look events', () => {
  it('excludes old multi-day/all-day trips and past timed events even when Google returns them', () => {
    const old = { summary: 'Vermont Weekend', start: new Date('2026-10-03'), startDate: '2026-10-03', allDay: true }
    expect(findingIsUpcoming(old, now, 'Asia/Singapore')).toBe(false)
    expect(formatFirstFinding(old, null, now, 'Asia/Singapore')).toBeNull()
    expect(findingIsUpcoming({ ...old, start: new Date('2026-10-10T10:00Z'), allDay: false }, now, 'Asia/Singapore')).toBe(false)
  })
  it('keeps current local date-only events without shifting their day at midnight UTC', () => {
    const e = { summary: 'Trip', start: new Date('2026-10-10'), startDate: '2026-10-10', allDay: true }
    expect(findingIsUpcoming(e, now, 'Asia/Singapore')).toBe(true)
    expect(formatFirstFinding(e, null, now, 'Asia/Singapore')).toContain('2026-10-10 (all day)')
    expect(findingIsUpcoming(e, new Date('2026-10-11T00:00Z'), 'America/Los_Angeles')).toBe(true)
  })
  it('gates cached first-look delivery to a recent computation', () => {
    expect(readFileSync('src/lib/spectrum/first-look.ts', 'utf8')).toContain(".gte('first_look_at',")
  })
})
