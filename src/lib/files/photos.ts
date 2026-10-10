/**
 * Free, credited photos for hosted pages. No paid vendor, no key.
 *
 * Sources: Wikimedia Commons (open licences, author and licence come back with
 * the file) and Open Library covers for books. Nothing else. The page never
 * loads an image from a remote server: each photo is fetched here, checked,
 * and shipped as a file next to the page (img/<name>.jpg), so opening the page
 * contacts nobody and the photo lives and expires with the page.
 *
 * Only the subject the model named ("2021 Ford Bronco", a hotel name, a book
 * title) goes to Wikimedia, and only when the caller says the turn is clean
 * (no Gmail/Calendar text in it). Fetches are https, host-allowlisted, size
 * capped, time capped, and the bytes must be a real JPEG, PNG or WebP.
 */
import { createHash } from 'crypto'
import { LOCAL_IMG } from '@/lib/files/kinds'

const UA = 'Dinghy/1.0 (https://www.getdinghy.sh; hosted page photos)'
const TIMEOUT_MS = 8000
const MAX_BYTES = 2_500_000
const MAX_PHOTOS = 6

const API_HOST = 'commons.wikimedia.org'
const API_HOSTS = new Set([API_HOST, 'openlibrary.org'])
const IMAGE_HOSTS = new Set(['upload.wikimedia.org', 'thumb.wikimedia.org', 'covers.openlibrary.org'])

export interface Photo { path: string; bytes: Buffer; contentType: string; credit: string; license: string }
export type Fetcher = (url: string, init?: { headers?: Record<string, string>; redirect?: 'error' | 'follow' | 'manual' }) => Promise<Response>

const sniff = (b: Buffer): { ext: string; type: string } | null => {
    if (b.length > 12 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { ext: 'jpg', type: 'image/jpeg' }
    if (b.length > 12 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { ext: 'png', type: 'image/png' }
    if (b.length > 12 && b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP') return { ext: 'webp', type: 'image/webp' }
    return null
}

const strip = (s: string) => s.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim().slice(0, 60)

/** Open licences we show. Anything else (or unknown) is skipped, not guessed. */
const OK_LICENSE = /^(CC0|CC BY(?:-SA)? [0-9.]+|Public domain|PD)/i

async function guarded(fetcher: Fetcher, url: string, headers?: Record<string, string>): Promise<Response> {
    const u = new URL(url)
    if (u.protocol !== 'https:' || (!API_HOSTS.has(u.hostname) && !IMAGE_HOSTS.has(u.hostname))) throw new Error('host not allowed')
    const res = await fetcher(url, { redirect: 'error', headers: { 'User-Agent': UA, ...(headers ?? {}) } })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res
}

/** Open Library covers redirect into the Internet Archive (up to three hops, archive hosts only). */
const ARCHIVE = /^[a-z0-9-]+\.us\.archive\.org$|^archive\.org$/

async function bytesOf(fetcher: Fetcher, url: string): Promise<Buffer> {
    let res: Response
    if (new URL(url).hostname === 'covers.openlibrary.org') {
        let cur = url
        res = await fetcher(cur, { redirect: 'manual', headers: { 'User-Agent': UA } })
        for (let hop = 0; hop < 3 && res.status >= 300 && res.status < 400; hop++) {
            const loc = res.headers.get('location')
            const next = loc ? new URL(loc, cur) : null
            if (!next || next.protocol !== 'https:' || !ARCHIVE.test(next.hostname)) throw new Error('redirect not allowed')
            cur = next.toString()
            res = await fetcher(cur, { redirect: 'manual', headers: { 'User-Agent': UA } })
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
    } else {
        res = await guarded(fetcher, url)
    }
    const len = Number(res.headers.get('content-length') ?? 0)
    if (len > MAX_BYTES) throw new Error('too large')
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length > MAX_BYTES) throw new Error('too large')
    return buf
}

async function fromCommons(fetcher: Fetcher, query: string): Promise<{ url: string; credit: string; license: string } | null> {
    const q = new URLSearchParams({
        action: 'query', generator: 'search', gsrsearch: `filetype:bitmap ${query}`, gsrnamespace: '6', gsrlimit: '5',
        prop: 'imageinfo', iiprop: 'url|extmetadata|size', iiurlwidth: '960', format: 'json', origin: '*',
    })
    const res = await guarded(fetcher, `https://${API_HOST}/w/api.php?${q}`)
    const data = (await res.json()) as { query?: { pages?: Record<string, { imageinfo?: { thumburl?: string; width?: number; height?: number; extmetadata?: Record<string, { value?: string }> }[] }> } }
    for (const page of Object.values(data.query?.pages ?? {})) {
        const ii = page.imageinfo?.[0]
        const license = strip(ii?.extmetadata?.LicenseShortName?.value ?? '')
        if (!ii?.thumburl || !OK_LICENSE.test(license) || (ii.width ?? 0) < 600) continue
        return { url: ii.thumburl, credit: strip(ii.extmetadata?.Artist?.value ?? '') || 'Wikimedia Commons', license }
    }
    return null
}

/** Fetch one photo for a subject, or null. Never throws. */
export async function findPhoto(subject: string, kind: 'general' | 'book', fetcher: Fetcher = fetch): Promise<Photo | null> {
    const name = subject.replace(/\s+/g, ' ').trim().slice(0, 80)
    if (name.length < 3) return null
    try {
        let url = '', credit = '', license = ''
        if (kind === 'book') {
            const sr = await guarded(fetcher, `https://openlibrary.org/search.json?${new URLSearchParams({ title: name, limit: '1', fields: 'cover_i' })}`)
            const cover = ((await sr.json()) as { docs?: { cover_i?: number }[] }).docs?.[0]?.cover_i
            if (!Number.isInteger(cover) || (cover as number) <= 0) return null
            url = `https://covers.openlibrary.org/b/id/${cover}-L.jpg?default=false`
            credit = 'Open Library'; license = 'cover'
        } else {
            const hit = await fromCommons(fetcher, name)
            if (!hit) return null
            ;({ url, credit, license } = hit)
        }
        const bytes = await bytesOf(fetcher, url)
        const kindOf = sniff(bytes)
        if (!kindOf) return null
        const id = createHash('sha256').update(bytes).digest('hex').slice(0, 12)
        return { path: `img/p-${id}.${kindOf.ext}`, bytes, contentType: kindOf.type, credit, license }
    } catch {
        return null
    }
}

const FENCE = /^(\s*:::\s*)(media|stay|gallery)(\s*)$/i

/**
 * Fill empty photo columns (media: col 7, stay: col 6) and "photo: subject | caption"
 * gallery lines with local copies. Returns the rewritten body and the files to ship.
 * Off (body unchanged) when `allowed` is false. A line that finds nothing keeps its colour card.
 */
export async function attachPhotos(body: string, opts: { allowed: boolean; fetcher?: Fetcher }): Promise<{ body: string; photos: Photo[] }> {
    if (!opts.allowed) return { body, photos: [] }
    const lines = body.split('\n')
    const photos: Photo[] = []
    const jobs: Promise<void>[] = []
    const credits: string[] = []
    let block: string | null = null
    for (let i = 0; i < lines.length; i++) {
        const open = lines[i].match(FENCE)
        if (open) { block = open[2].toLowerCase(); continue }
        if (/^\s*:::\s*$/.test(lines[i])) { block = null; continue }
        if (!block || photos.length + jobs.length >= MAX_PHOTOS) continue
        const cols = lines[i].split('|').map((c) => c.trim())
        const idx = i
        if (block === 'gallery') {
            const m = cols[0].match(/^photo:\s*(.{3,80})$/i)
            if (!m) continue
            jobs.push(findPhoto(m[1], 'general', opts.fetcher).then((p) => {
                if (!p) { lines[idx] = ''; return }
                photos.push(p)
                lines[idx] = [p.path, cols[1] ?? m[1], p.credit, p.license].join(' | ')
            }))
        } else {
            const col = block === 'media' ? 6 : 5
            if (!cols[0] || (cols[col] ?? '') !== '' || LOCAL_IMG.test(cols[col] ?? '')) continue
            const book = block === 'media' && /^book$/i.test(cols[1] ?? '')
            const subject = block === 'stay' ? `${cols[0]} hotel` : cols[0]
            jobs.push(findPhoto(subject, book ? 'book' : 'general', opts.fetcher).then((p) => {
                if (!p) return
                photos.push(p)
                while (cols.length <= col) cols.push('')
                cols[col] = p.path
                credits.push(`${cols[0]}: ${p.credit}${p.license && p.license !== 'cover' ? `, ${p.license}` : ''}`)
                lines[idx] = cols.join(' | ')
            }))
        }
    }
    await Promise.all(jobs)
    return { body: lines.join('\n') + (credits.length ? `\n\nPhoto credits: ${credits.join('; ')}` : ''), photos }
}
