/**
 * Shareable web links for Dinghy files, hosted on here.now.
 *
 * A shared file is its HTML render published as a small here.now Site, so
 * anyone the user forwards the link to sees a proper page (not a download).
 * Sites are public to anyone with the link, so we only publish when the
 * user asked for a link. Off unless HERENOW_API_KEY is set.
 */

import { createHash } from 'crypto'

const API = 'https://here.now/api/v1'
const CLIENT = 'dinghy/files'
const TIMEOUT_MS = 15_000

export function shareEnabled(): boolean {
    return Boolean(process.env.HERENOW_API_KEY)
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
    if (!res.ok) throw new Error(`here.now ${path} ${res.status}`)
    return (await res.json()) as T
}

/** Publish one HTML page; returns the public URL. Throws on any failure. */
export async function publishHtml(html: string, title: string): Promise<string> {
    if (!shareEnabled()) throw new Error('sharing is not set up')
    const bytes = Buffer.from(html, 'utf8')
    const hash = createHash('sha256').update(bytes).digest('hex')
    const created = await call<CreateResponse>('/publish', {
        method: 'POST',
        body: JSON.stringify({
            files: [{ path: 'index.html', size: bytes.length, contentType: 'text/html; charset=utf-8', hash }],
            displayName: title.slice(0, 80),
            folder: 'Dinghy',
        }),
    })
    for (const u of created.upload.uploads) {
        const put = await fetch(u.url, {
            method: 'PUT',
            body: bytes,
            headers: { 'Content-Type': 'text/html; charset=utf-8', ...(u.headers ?? {}) },
            signal: AbortSignal.timeout(TIMEOUT_MS),
        })
        if (!put.ok) throw new Error(`here.now upload ${put.status}`)
    }
    await call(`/publish/${encodeURIComponent(created.slug)}/finalize`, {
        method: 'POST',
        body: JSON.stringify({ versionId: created.upload.versionId }),
    })
    return created.siteUrl
}
