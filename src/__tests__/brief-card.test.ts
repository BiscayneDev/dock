import { describe, it, expect } from 'vitest'
import * as React from 'react'
import { parseBriefReply, plainBrief, cardDate, cardTime } from '@/lib/spectrum/brief-card-send'
import { parseLocation, isLocationAttachment } from '@/lib/spectrum/location'
import { compass, conditionsNote } from '@/lib/weather/brief-weather'

const meta = { date: 'wednesday, sept 23', time: '8:02 am' }

describe('parseBriefReply', () => {
    it('reads card JSON, even wrapped in prose or fences', () => {
        const reply = 'here you go\n```json\n' + JSON.stringify({
            opener: 'grey skies, calm water.',
            accent: 'worth your time.',
            on_deck: [{ when: 'all day', what: "Mahoney's birthday", note: 'text him' }],
            worth: [{ tag: 'Reply', from: 'Joe & The Juice', what: 'answered your review' }],
            rest: { count: 18, from: ['Zillow', 'Target', 'Product Hunt', 'extra'] },
            text: 'grey skies. mahoney turns 30.',
        }) + '\n```'
        const b = parseBriefReply(reply, meta)!
        expect(b.card.opener).toBe('grey skies, calm water.')
        expect(b.card.worth[0].tag).toBe('reply')
        expect(b.card.rest).toEqual({ count: 18, from: ['zillow', 'target', 'product hunt'] })
        expect(b.text).toBe('grey skies. mahoney turns 30.')
    })
    it('returns null for plain text or missing opener', () => {
        expect(parseBriefReply('morning! two emails today.', meta)).toBeNull()
        expect(parseBriefReply('{"worth": []}', meta)).toBeNull()
        expect(parseBriefReply('{not json}', meta)).toBeNull()
    })
    it('builds text from fields when the model skips it', () => {
        const b = parseBriefReply(JSON.stringify({ opener: 'quiet one.', on_deck: [], worth: [] }), {
            ...meta,
            weather: { place: 'miami', temp: 78, sky: 'overcast', high: 82, low: 76 },
        })!
        expect(b.text).toContain('quiet one.')
        expect(b.text).toContain('78° and overcast in miami')
        expect(plainBrief(b.card)).toBe(b.text)
    })
    it('caps list lengths', () => {
        const many = Array.from({ length: 9 }, (_, i) => ({ when: `${i}`, what: `e${i}`, tag: 't', from: 'f' }))
        const b = parseBriefReply(JSON.stringify({ opener: 'busy.', on_deck: many, worth: many }), meta)!
        expect(b.card.onDeck).toHaveLength(4)
        expect(b.card.worth).toHaveLength(3)
    })
})

describe('card date/time', () => {
    it('formats lowercase with sept', () => {
        const d = new Date('2026-09-23T12:02:00Z')
        expect(cardDate(d, 'America/New_York')).toBe('wednesday, sept 23')
        expect(cardTime(d, 'America/New_York')).toBe('8:02 am')
    })
})

describe('parseLocation', () => {
    it('reads an iMessage .loc.vcf', () => {
        const vcf = 'BEGIN:VCARD\nVERSION:3.0\nitem1.URL;type=pref:http://maps.apple.com/?ll=25.761681,-80.191788&q=25.761681,-80.191788\nEND:VCARD'
        expect(parseLocation(vcf)).toEqual({ lat: 25.761681, lon: -80.191788 })
        expect(isLocationAttachment('CL.loc.vcf', 'text/x-vcard')).toBe(true)
        expect(isLocationAttachment('Jane.vcf', 'text/vcard')).toBe(false)
    })
    it('reads google maps and geo links', () => {
        expect(parseLocation('https://www.google.com/maps/@41.0534,-73.5387,15z')).toEqual({ lat: 41.0534, lon: -73.5387 })
        expect(parseLocation('geo:40.7,-74.0')).toEqual({ lat: 40.7, lon: -74 })
    })
    it('rejects junk', () => {
        expect(parseLocation('http://maps.apple.com/?q=coffee')).toBeNull()
        expect(parseLocation('geo:0,0')).toBeNull()
        expect(parseLocation('geo:123,45')).toBeNull()
    })
})

describe('weather helpers', () => {
    it('compass', () => {
        expect(compass(125)).toBe('SE')
        expect(compass(359)).toBe('N')
        expect(compass(-90)).toBe('W')
    })
    it('notes only notable days', () => {
        expect(conditionsNote({ code: 3, high: 82, rain: 71 })).toMatch(/71% chance of rain/)
        expect(conditionsNote({ code: 95, high: 82, rain: 90 })).toMatch(/storms/)
        expect(conditionsNote({ code: 1, high: 80, rain: 10 })).toBeUndefined()
        expect(conditionsNote({ code: 0, high: 95, rain: 0 })).toMatch(/hot one/)
    })
})

describe('renderBriefCard', () => {
    it('renders a PNG with and without weather', async () => {
        ;(globalThis as unknown as { React: typeof React }).React = React
        const { renderBriefPng } = await import('@/lib/spectrum/brief-card-send')
        for (const weather of [undefined, { place: 'miami', temp: 78, sky: 'overcast', high: 82, low: 76, wind: 'SE 5 KT', rain: 71, note: 'x' }]) {
            const png = await renderBriefPng({ ...meta, opener: 'hi.', onDeck: [], worth: [], weather })
            expect(png.subarray(1, 4).toString()).toBe('PNG')
        }
    }, 60000)
})
