import { assertAccountActive } from '@/lib/data-portability/erasure-state'
/**
 * Hosted Dinghy files on here.now.
 *
 * A file is published as a small here.now Site: the HTML render as
 * index.html plus the PDF next to it. The link opens with no code: privacy
 * is an unguessable slug, noindex, and a 7-day expiry. The link itself is
 * the share mechanism: forward it and the other person can open it too.
 * revokeSite deletes a file so its link stops working.
 * Off unless HERENOW_API_KEY is set.
 */

import { createHash } from 'crypto'
import { createServerClient } from '@/lib/supabase/server'

const API = 'https://here.now/api/v1'
const CLIENT = 'dinghy/files'
const TIMEOUT_MS = 15_000
const FOLDER = 'Dinghy'
/** Hosted files expire after 7 days unless HERENOW_TTL_DAYS says otherwise. */
const DEFAULT_TTL_DAYS = 7

export function shareEnabled(): boolean {
    return Boolean(process.env.HERENOW_API_KEY)
}

export function ttlSeconds(): number {
    const days = Number(process.env.HERENOW_TTL_DAYS)
    return Math.round((Number.isFinite(days) && days > 0 ? days : DEFAULT_TTL_DAYS) * 86_400)
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

/** Publish files as one Site; returns its link. Throws on any failure. */
export async function publishSite(files: SiteFile[], opts: { title: string; userId: string }): Promise<PublishedSite> {
    await assertAccountActive(opts.userId)
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
    await call(`/publish/${encodeURIComponent(slug)}/finalize`, {
        method: 'POST',
        body: JSON.stringify({ versionId: created.upload.versionId }),
    })
    return { url: created.siteUrl, slug, expiresAt: new Date(Date.now() + ttl * 1000).toISOString() }
}

interface SiteDetails { slug: string; siteUrl: string; displayName?: string; displayDescription?: string; expiresAt?: string | null }

/**
 * Delete a file this user made so its link stops working for everyone.
 * Refuses Sites that aren't this user's Dinghy files.
 */
export async function revokeSite(link: string, userId: string): Promise<{ url: string; title?: string }> {
    if (!shareEnabled()) throw new Error('hosted files are not set up')
    const slug = slugFrom(link)
    if (!slug) throw new Error('not a Dinghy file link')
    const { data: saved, error } = await createServerClient().from('dinghy_files').select('id').eq('user_id', userId).eq('url', `https://${slug}.here.now/`).limit(1).maybeSingle()
    if (error) throw new Error('Could not verify file ownership')
    let site: SiteDetails
    try { site = await call<SiteDetails>(`/publish/${encodeURIComponent(slug)}`, { method: 'GET' }) } catch (err) {
        // A deleted/expired hosted page can be synced only with DB ownership.
        if (saved && err instanceof Error && / 404$/.test(err.message)) return { url: `https://${slug}.here.now/` }
        throw err
    }
    if (site.displayDescription !== ownerLine(ownerTag(userId))) throw new Error('not one of your files')
    await call(`/publish/${encodeURIComponent(slug)}`, { method: 'DELETE' })
    return { url: site.siteUrl, ...(site.displayName ? { title: site.displayName } : {}) }
}

/** Provider inventory independent of dinghy_files. Includes staged/orphan pages.
 * Contract verified from https://here.now/openapi.json (listSites).
 */
export async function listOwnedSites(userId: string): Promise<string[]> {
    if (!shareEnabled()) throw new Error('hosted_inventory_unavailable')
    const links: string[] = [], seen = new Set<string>()
    let cursor: string | null = null
    do {
        const q = new URLSearchParams({ scope: 'all', limit: '100' })
        if (cursor) q.set('cursor', cursor)
        const page = await call<{ scope?: string; publishes?: Array<{ slug: string; siteUrl: string; ownership?: string; displayDescription?: string | null }>; nextCursor?: string | null }>(`/publishes?${q}`, { method: 'GET' })
        if (page.scope !== 'all' || !Array.isArray(page.publishes) || !('nextCursor' in page)) throw new Error('hosted_inventory_schema_changed')
        for (const s of page.publishes) {
            if (s.ownership !== 'owned' || s.displayDescription !== ownerLine(ownerTag(userId))) continue
            if (slugFrom(s.siteUrl) !== s.slug) throw new Error('hosted_inventory_invalid_link')
            links.push(s.siteUrl)
        }
        cursor = page.nextCursor ?? null
        if (cursor && seen.has(cursor)) throw new Error('hosted_inventory_cursor_loop')
        if (cursor) seen.add(cursor)
    } while (cursor)
    return [...new Set(links)]
}
/** Re-verify provider ownership, not a DB row, immediately before removing an orphan. */
export async function revokeOwnedSite(link: string, userId: string): Promise<void> {
    const slug = slugFrom(link)
    if (!slug) throw new Error('hosted_inventory_invalid_link')
    let site: SiteDetails
    try { site = await call<SiteDetails>(`/publish/${encodeURIComponent(slug)}`, {method:'GET'}) }
    catch(e) { if(e instanceof Error && / 404$/.test(e.message)) return; throw e }
    if(site.displayDescription !== ownerLine(ownerTag(userId))) throw new Error('hosted_owner_mismatch')
    await call(`/publish/${encodeURIComponent(slug)}`, {method:'DELETE'})
    try { await call(`/publish/${encodeURIComponent(slug)}`, {method:'GET'}) }
    catch(e) { if(e instanceof Error && / 404$/.test(e.message)) return; throw e }
    throw new Error('hosted_delete_unverified')
}
