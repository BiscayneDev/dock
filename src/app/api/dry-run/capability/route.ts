import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { z } from 'zod'
import { runDryRun } from '@/lib/dry-run/run'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

/**
 * Capability hill-climb dry run. Refuses to exist unless ALL hold:
 *  - DINGHY_DRY_RUN=1 is set on this deployment (never set it on production),
 *  - this is not a Vercel production deployment,
 *  - the request host is not the production site,
 *  - the bearer token matches DRY_RUN_TOKEN (constant-time compare).
 * The handler has no database access: see lib/dry-run/world.ts.
 */
const Body = z.object({
  scenario: z.object({
    id: z.string().max(40).optional(),
    msg: z.string().min(1).max(2000),
    world: z.any().optional(),
    forbidden: z.array(z.string().max(200)).max(20).optional(),
  }),
  dry_run: z.literal(true),
})

function tokenOk(header: string | null): boolean {
  const want = process.env.DRY_RUN_TOKEN
  if (!want || want.length < 24 || !header?.startsWith('Bearer ')) return false
  const a = Buffer.from(header.slice(7))
  const b = Buffer.from(want)
  return a.length === b.length && timingSafeEqual(a, b)
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const host = (request.headers.get('host') ?? '').toLowerCase()
  if (process.env.DINGHY_DRY_RUN !== '1' || process.env.VERCEL_ENV === 'production' || host.includes('getdinghy.sh')) {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }
  if (!tokenOk(request.headers.get('authorization'))) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }
  const parsed = Body.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'invalid request: need {scenario:{msg}, dry_run:true}' }, { status: 400 })
  try {
    return NextResponse.json(await runDryRun(parsed.data.scenario))
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 })
  }
}
