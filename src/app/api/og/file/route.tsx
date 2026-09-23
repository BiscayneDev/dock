import type { ImageResponse } from 'next/og'
import { clip, renderOgCard } from '@/lib/brand/og-card'

export const runtime = 'nodejs'

const KINDS = new Set(['pdf', 'docx', 'word', 'html', 'page', 'csv', 'itinerary', 'plan', 'doc', 'file'])

/**
 * Per-file link card: /api/og/file?title=&kind=&meta=&sub=
 *   title  file title (required; falls back to "a file from dinghy")
 *   kind   short type label, e.g. pdf, itinerary
 *   meta   short extra label, e.g. "3 pages"
 *   sub    one sentence under the title
 */
export async function GET(req: Request): Promise<ImageResponse> {
  const q = new URL(req.url).searchParams
  const title = clip((q.get('title') ?? '').toLowerCase(), 80) || 'a file from dinghy'
  const rawKind = (q.get('kind') ?? '').toLowerCase().trim()
  const kind = KINDS.has(rawKind) ? rawKind : 'file'
  const meta = clip(q.get('meta') ?? '', 24)
  const sub = clip(q.get('sub') ?? '', 110)
  return renderOgCard({
    label: meta ? `${kind} · ${meta}` : kind,
    title,
    sub: sub || undefined,
    foot: 'made by dinghy',
  })
}
