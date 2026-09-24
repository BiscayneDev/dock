import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => ({}) }))

import { cleanPlans, isAbsence, matchPlan, mergePlan, renderFileLine, renderPlan, type PlanRow } from '@/lib/spectrum/plans'
import { cleanFacts } from '@/lib/spectrum/memory'

describe('isAbsence', () => {
    it('catches failed lookups stated as facts', () => {
        for (const s of [
            'User has not yet booked or created calendar events for the France trip to Reims',
            "Hasn't booked flights yet",
            'No calendar events found for the trip',
            'Nothing in their email about the hotel',
            'Could not find a booking',
        ])
            expect(isAbsence(s), s).toBe(true)
    })
    it('keeps real statements', () => {
        for (const s of ['Going to Reims after the wedding in Spain', 'Booked the Hotel Paris for Sep 30', 'Prefers aisle seats'])
            expect(isAbsence(s), s).toBe(false)
    })
})

describe('cleanPlans', () => {
    it('validates dates, drops absences, defaults kind/source, caps count', () => {
        const out = cleanPlans([
            { title: 'Spain wedding then France', starts_on: '2026-10-10', ends_on: '2026-10-03', places: ['Spain', 'Reims', 'Reims'], source: 'user' },
            { title: 'France trip', details: 'not booked yet' },
            { title: 'x' },
            { title: 'Dinner', starts_on: 'next week', kind: 'event', source: 'bogus' },
            { title: 'A1' },
            { title: 'A2' },
        ])
        expect(out).toHaveLength(3)
        expect(out[0]).toMatchObject({ starts_on: '2026-10-03', ends_on: '2026-10-10', places: ['Spain', 'Reims'], kind: 'trip', source: 'user' })
        expect(out[1]).toMatchObject({ title: 'Dinner', starts_on: null, kind: 'event', source: 'user' })
        expect(cleanPlans('nope')).toEqual([])
    })
})

const row = (p: Partial<PlanRow>): PlanRow => ({
    id: 'p1', title: 'France trip', kind: 'trip', starts_on: null, ends_on: null, places: [], people: [], details: '', source: 'user', ...p,
})

describe('matchPlan / mergePlan', () => {
    it('matches by title or by overlapping dates with a shared place', () => {
        const existing = [row({ id: 'a', title: 'Spain wedding', starts_on: '2026-10-01', ends_on: '2026-10-04', places: ['Madrid'] }), row({ id: 'b', title: 'France trip' })]
        expect(matchPlan(row({ title: 'france trip!' }), existing)?.id).toBe('b')
        expect(matchPlan(row({ title: 'Wedding weekend', starts_on: '2026-10-03', places: ['madrid'] }), existing)?.id).toBe('a')
        expect(matchPlan(row({ title: 'Tokyo', starts_on: '2026-10-03', places: ['Tokyo'] }), existing)).toBeNull()
    })
    it('merges: new values win, lists union, details kept unless replaced', () => {
        const m = mergePlan(row({ starts_on: '2026-10-05', places: ['Reims'], people: ['Ana'], details: 'after the wedding' }), row({ ends_on: '2026-10-07', places: ['reims', 'Paris'], details: '' }))
        expect(m).toMatchObject({ starts_on: '2026-10-05', ends_on: '2026-10-07', places: ['Reims', 'Paris'], people: ['Ana'], details: 'after the wedding' })
    })
})

describe('rendering', () => {
    it('renders a plan with its source', () => {
        expect(renderPlan(row({ starts_on: '2026-10-05', ends_on: '2026-10-07', places: ['Reims'], details: 'fly home Wed' }))).toBe(
            'France trip (Oct 5 to Oct 7) · Reims · fly home Wed [source: user]',
        )
        expect(renderPlan(row({}))).toContain('dates not set')
    })
    it('renders file lines and hides expired links', () => {
        const f = { title: 'Spain itinerary', format: 'page', url: 'https://x.here.now', markdown: '', expires_at: '2026-10-01T00:00:00Z', created_at: '2026-09-24T12:00:00Z' }
        expect(renderFileLine(f, '2026-09-25')).toBe('Spain itinerary (page, made Sep 24) https://x.here.now')
        expect(renderFileLine(f, '2026-10-02')).toContain('link expired')
    })
})

describe('facts extraction guard', () => {
    it('cleanFacts drops absence facts', () => {
        const out = cleanFacts([{ content: 'Prefers window seats', type: 'preference' }, { content: 'User has not yet booked the Reims trip', type: 'fact' }], [])
        expect(out.map((f) => f.content)).toEqual(['Prefers window seats'])
    })
})
