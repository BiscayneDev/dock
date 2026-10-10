import { describe, expect, it } from 'vitest'
import { attachPhotos, findPhoto, type Fetcher } from '@/lib/files/photos'

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(40, 1)])
const json = (o: unknown) => new Response(JSON.stringify(o), { status: 200 })
const commons = (license: string, width = 900) => json({
    query: { pages: { 1: { imageinfo: [{ thumburl: 'https://upload.wikimedia.org/x/boat.jpg', width, extmetadata: { LicenseShortName: { value: license }, Artist: { value: '<a href="x">Sam Example</a>' } } }] } } },
})
const fake = (license = 'CC BY 4.0', img: Buffer | Response = JPEG): { f: Fetcher; calls: string[] } => {
    const calls: string[] = []
    const f: Fetcher = async (url) => {
        calls.push(url)
        if (url.includes('commons.wikimedia.org')) return commons(license)
        return img instanceof Response ? img : new Response(new Uint8Array(img), { status: 200 })
    }
    return { f, calls }
}

describe('page photos', () => {
    it('finds a credited photo and stores it under img/', async () => {
        const { f } = fake()
        const p = await findPhoto('Harbor Skiff', 'general', f)
        expect(p?.path).toMatch(/^img\/p-[0-9a-f]{12}\.jpg$/)
        expect(p?.credit).toBe('Sam Example')
        expect(p?.license).toBe('CC BY 4.0')
    })

    it('skips unknown licences, small images, non-images and oversize files', async () => {
        expect(await findPhoto('Harbor Skiff', 'general', fake('All rights reserved').f)).toBeNull()
        expect(await findPhoto('Harbor Skiff', 'general', fake('CC BY 4.0', Buffer.from('<html>not an image</html>')).f)).toBeNull()
        const big = new Response(new Uint8Array(10), { status: 200, headers: { 'content-length': '9000000' } })
        expect(await findPhoto('Harbor Skiff', 'general', fake('CC BY 4.0', big).f)).toBeNull()
        const small: Fetcher = async (u) => (u.includes('commons.wikimedia.org') ? commons('CC BY 4.0', 300) : new Response(new Uint8Array(JPEG)))
        expect(await findPhoto('Harbor Skiff', 'general', small)).toBeNull()
    })

    it('never fetches a host outside the allowlist', async () => {
        const calls: string[] = []
        const evil: Fetcher = async (url) => {
            calls.push(url)
            if (url.includes('commons.wikimedia.org')) return json({ query: { pages: { 1: { imageinfo: [{ thumburl: 'https://evil.example.test/a.jpg', width: 900, extmetadata: { LicenseShortName: { value: 'CC0' } } }] } } } })
            return new Response(new Uint8Array(JPEG))
        }
        expect(await findPhoto('Harbor Skiff', 'general', evil)).toBeNull()
        expect(calls.some((c) => c.includes('evil.example.test'))).toBe(false)
    })

    it('fills empty photo columns and gallery photo: lines, and adds credits', async () => {
        const { f } = fake()
        const body = ':::stay\nHarbor Inn | $120 | 8.8 | Old town | Thin walls | | https://example.test/i\n:::\n\n:::gallery\nphoto: Harbor Skiff | A skiff at dawn\n:::'
        const out = await attachPhotos(body, { allowed: true, fetcher: f })
        expect(out.photos.length).toBe(2)
        expect(out.body).toMatch(/Thin walls \| img\/p-[0-9a-f]{12}\.jpg \| https:\/\/example\.test\/i/)
        expect(out.body).toMatch(/img\/p-[0-9a-f]{12}\.jpg \| A skiff at dawn \| Sam Example \| CC BY 4\.0/)
        expect(out.body).toContain('Photo credits: Harbor Inn: Sam Example, CC BY 4.0')
    })

    it('does nothing, and makes no request, when the turn is not clean', async () => {
        const { f, calls } = fake()
        const body = ':::media\nNight Ferry | movie | 2021 | 7 | J. Director | Tight. | | \n:::'
        const out = await attachPhotos(body, { allowed: false, fetcher: f })
        expect(out.body).toBe(body)
        expect(calls).toHaveLength(0)
    })

    it('a lookup that finds nothing leaves the line alone', async () => {
        const none: Fetcher = async () => json({ query: { pages: {} } })
        const body = ':::stay\nHarbor Inn | $120 | 8.8 | Old town | Thin walls | | \n:::'
        expect((await attachPhotos(body, { allowed: true, fetcher: none })).body).toBe(body)
    })
})

describe('book covers', () => {
    it('looks the cover up by search, then fetches only the covers host', async () => {
        const calls: string[] = []
        const f: Fetcher = async (url) => {
            calls.push(url)
            return url.includes('openlibrary.org/search.json') ? json({ docs: [{ cover_i: 4242 }] }) : new Response(new Uint8Array(JPEG))
        }
        const p = await findPhoto('The Salt Road', 'book', f)
        expect(p?.credit).toBe('Open Library')
        expect(calls[1]).toBe('https://covers.openlibrary.org/b/id/4242-L.jpg?default=false')
        expect(await findPhoto('No Such Book', 'book', async () => json({ docs: [{}] }))).toBeNull()
    })
})

describe('cover redirects', () => {
    const redirect = (to: string) => new Response(null, { status: 302, headers: { location: to } })
    const search = () => json({ docs: [{ cover_i: 7 }] })

    it('follows redirects only into archive.org hosts', async () => {
        const f: Fetcher = async (url) => {
            if (url.includes('search.json')) return search()
            if (url.startsWith('https://covers.')) return redirect('https://archive.org/download/x/7-L.jpg')
            if (url.startsWith('https://archive.org/')) return redirect('https://ia800000.us.archive.org/7-L.jpg')
            return new Response(new Uint8Array(JPEG))
        }
        expect((await findPhoto('The Salt Road', 'book', f))?.credit).toBe('Open Library')
    })

    it('refuses a redirect to any other host', async () => {
        const calls: string[] = []
        const f: Fetcher = async (url) => {
            calls.push(url)
            if (url.includes('search.json')) return search()
            return redirect('https://evil.example.test/7.jpg')
        }
        expect(await findPhoto('The Salt Road', 'book', f)).toBeNull()
        expect(calls.some((c) => c.includes('evil.example.test'))).toBe(false)
    })
})
