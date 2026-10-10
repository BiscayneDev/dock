import * as React from 'react'
;(globalThis as unknown as { React: unknown }).React = React
import { describe, it, expect } from 'vitest'
import { renderKindCard } from '@/lib/brand/kind-card'

const PNG = [0x89, 0x50, 0x4e, 0x47]
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
})
