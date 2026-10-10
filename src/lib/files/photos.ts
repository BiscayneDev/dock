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

export interface Photo { path: string; bytes: Buffer; contentType: string; credit: string; license: string; sourceUrl?: string; licenseUrl?: string }
export type Fetcher = (url: string, init?: { headers?: Record<string, string>; redirect?: 'error' | 'follow' | 'manual'; signal?: AbortSignal }) => Promise<Response>

const MIN_SIDE = 300
const MAX_SIDE = 8000

/**
 * Structural check, not just a header peek: walks the file to find its real
 * dimensions and its end marker, so a truncated file, an HTML page with a magic
 * number glued on front, or a decompression-bomb size is refused. Returns null
 * for anything that is not a complete JPEG, PNG or WebP of a sensible size.
 */
export function validateImage(b: Buffer): { ext: string; type: string; w: number; h: number } | null {
    const ok = (ext: string, type: string, w: number, h: number) => (w >= MIN_SIDE && h >= MIN_SIDE * 0.5 && w <= MAX_SIDE && h <= MAX_SIDE ? { ext, type, w, h } : null)
    if (b.length > 24 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
        let i = 2
        let dims: [number, number] | null = null
        while (i + 4 < b.length) {
            if (b[i] !== 0xff) { i++; continue }
            const m = b[i + 1]
            if (m === 0xff) { i++; continue }
            if (m === 0xd9) break
            if (m === 0xd8 || (m >= 0xd0 && m <= 0xd7) || m === 0x01) { i += 2; continue }
            const len = b.readUInt16BE(i + 2)
            if (len < 2) return null
            if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) { dims = [b.readUInt16BE(i + 7), b.readUInt16BE(i + 5)]; break }
            if (m === 0xda) break
            i += 2 + len
        }
        const tail = b.subarray(Math.max(0, b.length - 4))
        const ended = tail.includes(Buffer.from([0xff, 0xd9]))
        return dims && ended ? ok('jpg', 'image/jpeg', dims[0], dims[1]) : null
    }
    if (b.length > 33 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
        if (b.subarray(12, 16).toString() !== 'IHDR') return null
        const iend = b.subarray(b.length - 12).toString('latin1').includes('IEND')
        return iend ? ok('png', 'image/png', b.readUInt32BE(16), b.readUInt32BE(20)) : null
    }
    if (b.length > 30 && b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP') {
        if (b.readUInt32LE(4) + 8 !== b.length) return null
        const fmt = b.subarray(12, 16).toString()
        if (fmt === 'VP8X') return ok('webp', 'image/webp', 1 + b.readUIntLE(24, 3), 1 + b.readUIntLE(27, 3))
        if (fmt === 'VP8 ') return ok('webp', 'image/webp', b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff)
        if (fmt === 'VP8L' && b[20] === 0x2f) { const v = b.readUInt32LE(21); return ok('webp', 'image/webp', (v & 0x3fff) + 1, ((v >> 14) & 0x3fff) + 1) }
        return null
    }
    return null
}

const clean = (s: string) => s.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim()
const strip = (s: string) => clean(s).slice(0, 60)

/** Open licences we show. Anything else (or unknown) is skipped, not guessed. */
/** Exact allowlist: nothing else passes, and no prefix matching. */
const OK_LICENSE = /^(CC0 1\.0|Public domain|CC BY [1-4]\.0|CC BY-SA [1-4]\.0|CC BY 2\.5|CC BY-SA 2\.5|CC BY 3\.0|CC BY-SA 3\.0)$/

async function guarded(fetcher: Fetcher, url: string, headers?: Record<string, string>): Promise<Response> {
    const u = new URL(url)
    if (u.protocol !== 'https:' || (!API_HOSTS.has(u.hostname) && !IMAGE_HOSTS.has(u.hostname))) throw new Error('host not allowed')
    const res = await fetcher(url, { redirect: 'error', signal: AbortSignal.timeout(TIMEOUT_MS), headers: { 'User-Agent': UA, ...(headers ?? {}) } })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res
}

/** Read a response body, stopping as soon as it passes the byte cap. */
async function readCapped(res: Response): Promise<Buffer> {
    if (Number(res.headers.get('content-length') ?? 0) > MAX_BYTES) throw new Error('too large')
    if (!res.body) {
        const whole = Buffer.from(await res.arrayBuffer())
        if (whole.length > MAX_BYTES) throw new Error('too large')
        return whole
    }
    const reader = res.body.getReader()
    const chunks: Buffer[] = []
    let total = 0
    for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        total += value.length
        if (total > MAX_BYTES) { await reader.cancel().catch(() => {}); throw new Error('too large') }
        chunks.push(Buffer.from(value))
    }
    return Buffer.concat(chunks)
}

/** Open Library covers redirect into the Internet Archive (up to three hops, archive hosts only). */
const ARCHIVE = /^[a-z0-9-]+\.us\.archive\.org$|^archive\.org$/

async function bytesOf(fetcher: Fetcher, url: string): Promise<Buffer> {
    let res: Response
    if (new URL(url).hostname === 'covers.openlibrary.org') {
        let cur = url
        res = await fetcher(cur, { redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS), headers: { 'User-Agent': UA } })
        for (let hop = 0; hop < 3 && res.status >= 300 && res.status < 400; hop++) {
            const loc = res.headers.get('location')
            const next = loc ? new URL(loc, cur) : null
            if (!next || next.protocol !== 'https:' || !ARCHIVE.test(next.hostname)) throw new Error('redirect not allowed')
            cur = next.toString()
            res = await fetcher(cur, { redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS), headers: { 'User-Agent': UA } })
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
    } else {
        res = await guarded(fetcher, url)
    }
    return readCapped(res)
}

const GENERIC = new Set(['the', 'and', 'for', 'hotel', 'inn', 'resort', 'photo', 'image'])
const fold = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()

/** True only when every distinctive word of the subject shows up in the file's title, name or categories. */
export function subjectMatches(subject: string, haystack: string): boolean {
    const words = fold(subject).split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !GENERIC.has(w))
    if (!words.length) return false
    const hay = fold(haystack)
    return words.every((w) => hay.includes(w))
}

const safeUrl = (u: string | undefined, host: RegExp): string | undefined => {
    try {
        const x = new URL(u ?? '')
        return x.protocol === 'https:' && host.test(x.hostname) && !/[\s|()]/.test(x.href) ? x.href : undefined
    } catch { return undefined }
}

type CommonsMeta = Record<string, { value?: string }>
async function fromCommons(fetcher: Fetcher, query: string): Promise<{ url: string; credit: string; license: string; sourceUrl?: string; licenseUrl?: string } | null> {
    const q = new URLSearchParams({
        action: 'query', generator: 'search', gsrsearch: `filetype:bitmap ${query}`, gsrnamespace: '6', gsrlimit: '8',
        prop: 'imageinfo', iiprop: 'url|extmetadata|size', iiurlwidth: '960', format: 'json', origin: '*',
    })
    const res = await guarded(fetcher, `https://${API_HOST}/w/api.php?${q}`)
    const data = (await res.json()) as { query?: { pages?: Record<string, { title?: string; imageinfo?: { thumburl?: string; descriptionurl?: string; width?: number; height?: number; extmetadata?: CommonsMeta }[] }> } }
    for (const page of Object.values(data.query?.pages ?? {})) {
        const ii = page.imageinfo?.[0]
        const md = ii?.extmetadata
        const license = clean(md?.LicenseShortName?.value ?? '')
        if (!ii?.thumburl || !OK_LICENSE.test(license) || (ii.width ?? 0) < 600) continue
        // Fail closed: the subject must show in the file title or name, and attribution must be complete.
        const hay = [page.title, md?.ObjectName?.value].map((v) => clean(v ?? '')).join(' ')
        if (!subjectMatches(query, hay)) continue
        const author = clean(md?.Artist?.value ?? '')
        const sourceUrl = safeUrl(ii.descriptionurl, /^commons\.wikimedia\.org$/)
        const licenseUrl = safeUrl(md?.LicenseUrl?.value, /(^|\.)creativecommons\.org$/)
        if (!author || author.length > 120 || /[\[\]()|]/.test(author) || !sourceUrl || !licenseUrl) continue
        return { url: ii.thumburl, credit: author, license, sourceUrl, licenseUrl }
    }
    return null
}

/** Fetch one photo for a subject, or null. Never throws. */
export async function findPhoto(subject: string, kind: 'general' | 'book', fetcher: Fetcher = fetch): Promise<Photo | null> {
    const name = subject.replace(/\s+/g, ' ').trim().slice(0, 80)
    if (name.length < 3) return null
    try {
        let url = '', credit = '', license = '', sourceUrl: string | undefined, licenseUrl: string | undefined
        if (kind === 'book') {
            const sr = await guarded(fetcher, `https://openlibrary.org/search.json?${new URLSearchParams({ title: name, limit: '1', fields: 'cover_i,key,title' })}`)
            const doc = ((await sr.json()) as { docs?: { cover_i?: number; key?: string; title?: string }[] }).docs?.[0]
            const cover = doc?.cover_i
            if (!subjectMatches(name, doc?.title ?? '')) return null
            if (!Number.isInteger(cover) || (cover as number) <= 0) return null
            url = `https://covers.openlibrary.org/b/id/${cover}-L.jpg?default=false`
            credit = 'Open Library'; license = 'cover'
            sourceUrl = /^\/works\/OL\d+W$/.test(doc?.key ?? '') ? `https://openlibrary.org${doc?.key}` : undefined
        } else {
            const hit = await fromCommons(fetcher, name)
            if (!hit) return null
            ;({ url, credit, license, sourceUrl, licenseUrl } = hit)
        }
        const bytes = await bytesOf(fetcher, url)
        const kindOf = validateImage(bytes)
        if (!kindOf) return null
        const id = createHash('sha256').update(bytes).digest('hex').slice(0, 12)
        return { path: `img/p-${id}.${kindOf.ext}`, bytes, contentType: kindOf.type, credit, license, sourceUrl, licenseUrl }
    } catch {
        return null
    }
}

function creditLine(name: string, p: Photo): string {
    const lic = p.license && p.license !== 'cover' ? (p.licenseUrl ? `[${p.license}](${p.licenseUrl})` : p.license) : ''
    const src = p.sourceUrl ? `[source](${p.sourceUrl})` : ''
    return `${name}: ${[p.credit, lic, src].filter(Boolean).join(', ')}`
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
                lines[idx] = [p.path, cols[1] ?? m[1], p.credit, p.license, p.sourceUrl ?? '', p.licenseUrl ?? ''].join(' | ')
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
                credits.push(creditLine(cols[0], p))
                lines[idx] = cols.join(' | ')
            }))
        }
    }
    await Promise.all(jobs)
    return { body: lines.join('\n') + (credits.length ? `\n\nPhoto credits: ${credits.join('; ')}` : ''), photos }
}
