import { describe, expect, it } from 'vitest'
import { attachPhotos, findPhoto, validateImage, type Fetcher } from '@/lib/files/photos'

/** A small but structurally complete JPEG: SOI, APP0, SOF0 with the given size, EOI. */
const jpeg = (w = 600, h = 400, end = true) => Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]), Buffer.from('JFIF\0'), Buffer.alloc(9, 0),
    Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 255, w >> 8, w & 255, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]),
    Buffer.from([0xff, 0xda, 0x00, 0x08, 1, 1, 0, 0, 0x3f, 0, 1, 2, 3]),
    ...(end ? [Buffer.from([0xff, 0xd9])] : []),
])
const JPEG = jpeg()
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


describe('validateImage', () => {
    it('accepts a complete jpeg and reads its size', () => {
        expect(validateImage(jpeg(800, 500))).toMatchObject({ ext: 'jpg', w: 800, h: 500 })
    })
    it('refuses a truncated jpeg, a tiny one, a huge one and html with a jpeg header glued on', () => {
        expect(validateImage(jpeg(600, 400, false))).toBeNull()
        expect(validateImage(jpeg(100, 80))).toBeNull()
        expect(validateImage(jpeg(20000, 20000))).toBeNull()
        expect(validateImage(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('<html><script>x</script></html>'.padEnd(60))]))).toBeNull()
    })
    it('checks png and webp structure', () => {
        const png = (w: number, h: number, end = true) => {
            const ihdr = Buffer.alloc(25)
            ihdr.writeUInt32BE(13, 0); ihdr.write('IHDR', 4); ihdr.writeUInt32BE(w, 8); ihdr.writeUInt32BE(h, 12)
            return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), ihdr, Buffer.alloc(8, 7), ...(end ? [Buffer.from([0, 0, 0, 0]), Buffer.from('IEND'), Buffer.alloc(4)] : [Buffer.alloc(12, 1)])])
        }
        expect(validateImage(png(640, 480))).toMatchObject({ ext: 'png', w: 640, h: 480 })
        expect(validateImage(png(640, 480, false))).toBeNull()
        const webp = (len: number) => {
            const b = Buffer.alloc(40)
            b.write('RIFF', 0); b.writeUInt32LE(len, 4); b.write('WEBP', 8); b.write('VP8X', 12)
            b.writeUIntLE(699, 24, 3); b.writeUIntLE(449, 27, 3)
            return b
        }
        expect(validateImage(webp(32))).toMatchObject({ ext: 'webp', w: 700, h: 450 })
        expect(validateImage(webp(5000))).toBeNull()
    })
})

describe('byte cap and timeout', () => {
    it('stops reading a body that runs past the cap', async () => {
        let pulled = 0
        const stream = new ReadableStream<Uint8Array>({
            pull(c) { pulled += 1; c.enqueue(new Uint8Array(1_000_000)); if (pulled > 50) c.close() },
        })
        const f: Fetcher = async (u) => (u.includes('commons.wikimedia.org') ? commons('CC BY 4.0') : new Response(stream, { status: 200 }))
        expect(await findPhoto('Harbor Skiff', 'general', f)).toBeNull()
        expect(pulled).toBeLessThan(10)
    })
    it('passes an abort signal on every request', async () => {
        const seen: (AbortSignal | undefined)[] = []
        const f: Fetcher = async (u, init) => { seen.push(init?.signal); return u.includes('commons.wikimedia.org') ? commons('CC BY 4.0') : new Response(new Uint8Array(JPEG)) }
        await findPhoto('Harbor Skiff', 'general', f)
        expect(seen.length).toBe(2)
        expect(seen.every(Boolean)).toBe(true)
    })
})
