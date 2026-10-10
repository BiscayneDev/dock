import * as React from 'react'
;(globalThis as unknown as { React: unknown }).React = React
import { describe, it, expect } from 'vitest'
import { renderKindCard, checkChips, routeSummary } from '@/lib/brand/kind-card'

const PNG = [0x89, 0x50, 0x4e, 0x47]
const TINY_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const weather = ':::weather\nPort Marlow | 61° | Light rain | 64° | 52° | 9 mph NW | 70%\nSat | 64° | 52° | Showers | 70%\nSun | 66° | 50° | Sunny | 5%\n:::'
const scores = ':::scores\nGulls | 3 | Otters | 1 | Final\nHawks | 10 | Owls | 7 | Q3 4:00\n:::'

describe('renderKindCard', () => {
    it('renders a PNG for weather', async () => {
        const b = await renderKindCard({ title: 'Port Marlow this week', body: weather })
        expect(b && [...b.subarray(0, 4)]).toEqual(PNG)
    }, 60000)
    it('renders a PNG for scores', async () => {
        const b = await renderKindCard({ title: 'Harbor League', body: scores })
        expect(b && [...b.subarray(0, 4)]).toEqual(PNG)
    }, 60000)
    it('returns null for other pages', async () => {
        expect(await renderKindCard({ title: 'Notes', body: 'plain text only' })).toBeNull()
    })

    const stay = ':::lead\nfor | Alex\npick | Harbor Inn | Step-free\nbeat | Pine Lodge | stairs\n:::\n\n:::stay\nHarbor Inn | $2,680 | 4.6 | Shelburne | rooms on request | img/p-abc123.png\nPine Lodge | $2,150 | 4.1 | Burlington | stairs |\n:::\n\n:::checks\nStep-free route | confirmed | hotel page | Oct 10\n:::'
    const route = ':::route\nHarbor Inn | Lakeside path | walk | 9 min | flat\nLakeside path | Aquarium | walk | 5 min | ramp\n:::'
    it('renders a stay card with and without a photo', async () => {
        const photo = { path: 'img/p-abc123.png', bytes: Buffer.from(TINY_PNG, 'base64'), contentType: 'image/png', credit: 'Sam Example', license: 'CC BY 4.0' }
        const a = await renderKindCard({ title: 'Stay', body: stay }, [photo])
        const b = await renderKindCard({ title: 'Stay', body: stay })
        expect(a && [...a.subarray(0, 4)]).toEqual(PNG)
        expect(b && [...b.subarray(0, 4)]).toEqual(PNG)
    }, 60000)
    it('renders a route card', async () => {
        const b = await renderKindCard({ title: 'Route', body: route })
        expect(b && [...b.subarray(0, 4)]).toEqual(PNG)
    }, 60000)
    it('draws nothing for an empty route or stay block', async () => {
        expect(await renderKindCard({ title: 'x', body: ':::route\nonly one cell\n:::' })).toBeNull()
        expect(await renderKindCard({ title: 'x', body: ':::stay\n\n:::' })).toBeNull()
    })
})

describe('card fail-closed summaries', () => {
    it('requires exact confirmed plus source and date', () => {
        expect(checkChips(['A | confirmed | source | date', 'B | confirmed | | date', 'C | confirmed | source | ']).map(c => c.ok)).toEqual([true, false, false])
        expect(checkChips(['D | almost confirmed | source | date'])[0].ok).toBe(false)
    })
    it('counts the full route and marks hidden legs', () => {
        const lines = Array.from({ length: 5 }, (_, i) => `Stop ${i} | Stop ${i+1} | walk | 5 min | flat`)
        expect(routeSummary(lines)).toMatchObject({ eta: '25 min', hidden: 1, last: ['Stop 4', 'Stop 5', 'walk', '5 min', 'flat'] })
        expect(routeSummary([...lines, 'Stop 5 | Stop 6 | walk | unknown'])).toMatchObject({ eta: '6 legs', hidden: 2 })
    })
})

it('does not turn ambiguous durations into an ETA', () => {
    for (const t of ['5-10 min', '5 miles', 'about 5 min', 'unknown']) expect(routeSummary([`A | B | walk | ${t}`])?.eta).toBe('1 leg')
    expect(routeSummary(['A | B | rail | 1 hour 30 minutes'])?.eta).toBe('1 h 30 min')
})
