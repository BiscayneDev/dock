/**
 * Hosted Dinghy files on here.now.
 *
 * A file is published as a small here.now Site: the HTML render as
 * index.html plus the PDF next to it. Private by default: the Site gets a
 * visitor password (sent to the user in the thread) and every Site expires.
 * Sharing is opt-in per file and just drops the password.
 *
 * The password is set before the Site goes live (a Site serves nothing until
 * finalize), so a private file is never publicly reachable. If here.now
 * refuses the early lock we lock right after finalize, and delete the Site
 * if that fails too. Off unless HERENOW_API_KEY is set.
 */

import { createHash, randomInt } from 'crypto'

const API = 'https://here.now/api/v1'
const CLIENT = 'dinghy/files'
const TIMEOUT_MS = 15_000
const FOLDER = 'Dinghy'
/** Hosted files expire after 30 days unless HERENOW_TTL_DAYS says otherwise. */
const DEFAULT_TTL_DAYS = 30
/** No 0/o/1/l/i: easy to read off a phone and type. */
const CODE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'

export function shareEnabled(): boolean {
    return Boolean(process.env.HERENOW_API_KEY)
}

export function ttlSeconds(): number {
    const days = Number(process.env.HERENOW_TTL_DAYS)
    return Math.round((Number.isFinite(days) && days > 0 ? days : DEFAULT_TTL_DAYS) * 86_400)
}

/** 8-character visitor code, ~39 bits. */
export function makeCode(): string {
    let s = ''
    for (let i = 0; i < 8; i++) s += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]
    return s
}

/** Stable, non-reversible owner tag stored on each Site. */
export function ownerTag(userId: string): string {
    return createHash('sha256').update(`dinghy:${userId}`).digest('hex').slice(0, 16)
}

const ownerLine = (tag: string) => `dinghy file · owner ${tag}`

/** "https://calm-boat-1a2b.here.now/" or a bare slug → slug; null if not ours to parse. */
export function slugFrom(link: string): string | null {
    const s = link.trim()
    if (/^[a-z0-9-]{3,64}$/.test(s)) return s
    try {
        const u = new URL(s)
        const m = u.hostname.match(/^([a-z0-9-]+)\.here\.now$/)
        return m ? m[1] : null
    } catch {
        return null
    }
}

export interface SiteFile { path: string; bytes: Buffer; contentType: string }
export interface PublishedSite {
    url: string
    slug: string
    /** Visitor code; absent when the Site is shared (anyone with the link). */
    password?: string
    expiresAt: string
}

interface UploadTarget { path: string; url: string; headers?: Record<string, string> }
interface CreateResponse {
    slug: string
    siteUrl: string
    upload: { versionId: string; uploads: UploadTarget[]; skipped?: string[] }
}

async function call<T>(path: string, init: RequestInit): Promise<T> {
    const res = await fetch(`${API}${path}`, {
        ...init,
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: {
            Authorization: `Bearer ${process.env.HERENOW_API_KEY}`,
            'Content-Type': 'application/json',
            'X-HereNow-Client': CLIENT,
            ...(init.headers ?? {}),
        },
    })
    if (!res.ok) throw new Error(`here.now ${init.method ?? 'GET'} ${path} ${res.status}`)
    const text = await res.text()
    return (text ? JSON.parse(text) : {}) as T
}

const setPassword = (slug: string, password: string | null) =>
    call(`/publish/${encodeURIComponent(slug)}/metadata`, { method: 'PATCH', body: JSON.stringify({ password }) })

/**
 * Publish files as one Site. Private (password) unless opts.shared.
 * Throws on any failure; never leaves a private Site publicly reachable.
 */
export async function publishSite(files: SiteFile[], opts: { title: string; userId: string; shared?: boolean }): Promise<PublishedSite> {
    if (!shareEnabled()) throw new Error('hosted files are not set up')
    const ttl = ttlSeconds()
    const created = await call<CreateResponse>('/publish', {
        method: 'POST',
        body: JSON.stringify({
            files: files.map((f) => ({
                path: f.path,
                size: f.bytes.length,
                contentType: f.contentType,
                hash: createHash('sha256').update(f.bytes).digest('hex'),
            })),
            displayName: opts.title.slice(0, 80),
            displayDescription: ownerLine(ownerTag(opts.userId)),
            folder: FOLDER,
            ttlSeconds: ttl,
        }),
    })
    const slug = created.slug
    const byPath = new Map(files.map((f) => [f.path, f]))
    for (const u of created.upload.uploads) {
        const f = byPath.get(u.path)
        if (!f) continue
        const put = await fetch(u.url, {
            method: 'PUT',
            body: new Uint8Array(f.bytes),
            headers: { 'Content-Type': f.contentType, ...(u.headers ?? {}) },
            signal: AbortSignal.timeout(TIMEOUT_MS),
        })
        if (!put.ok) throw new Error(`here.now upload ${put.status}`)
    }
    const password = opts.shared ? undefined : makeCode()
    let locked = false
    if (password) {
        try {
            await setPassword(slug, password)
            locked = true
        } catch (err) {
            console.warn('[dinghy] early here.now lock refused, locking after finalize', err instanceof Error ? err.message : err)
        }
    }
    await call(`/publish/${encodeURIComponent(slug)}/finalize`, {
        method: 'POST',
        body: JSON.stringify({ versionId: created.upload.versionId }),
    })
    if (password && !locked) {
        try {
            await setPassword(slug, password)
        } catch (err) {
            await call(`/publish/${encodeURIComponent(slug)}`, { method: 'DELETE' }).catch(() => undefined)
            throw err
        }
    }
    return { url: created.siteUrl, slug, ...(password ? { password } : {}), expiresAt: new Date(Date.now() + ttl * 1000).toISOString() }
}

interface SiteDetails { slug: string; siteUrl: string; displayDescription?: string; expiresAt?: string | null }

/**
 * Share (drop the password) or make private again (new code) a file this
 * user made. Refuses Sites that aren't this user's Dinghy files.
 */
export async function setSharing(link: string, userId: string, share: boolean): Promise<PublishedSite> {
    if (!shareEnabled()) throw new Error('hosted files are not set up')
    const slug = slugFrom(link)
    if (!slug) throw new Error('not a Dinghy file link')
    const site = await call<SiteDetails>(`/publish/${encodeURIComponent(slug)}`, { method: 'GET' })
    if (site.displayDescription !== ownerLine(ownerTag(userId))) throw new Error('not one of your files')
    const password = share ? null : makeCode()
    await setPassword(slug, password)
    return { url: site.siteUrl, slug, ...(password ? { password } : {}), expiresAt: site.expiresAt ?? '' }
}
