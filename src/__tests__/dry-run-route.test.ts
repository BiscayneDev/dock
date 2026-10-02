import { describe, it, expect, vi, afterEach } from 'vitest'
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => ({}) }))
const runDryRun = vi.hoisted(() => vi.fn(async () => ({ dry_run: true, reply: 'hi' })))
vi.mock('@/lib/dry-run/run', () => ({ runDryRun }))
import { POST } from '@/app/api/dry-run/capability/route'
import { NextRequest } from 'next/server'

const TOKEN = 't'.repeat(32)
const req = (host = 'staging.example.vercel.app', auth: string | null = `Bearer ${TOKEN}`, body: unknown = { scenario: { msg: 'hi' }, dry_run: true }) =>
  new NextRequest(`https://${host}/api/dry-run/capability`, { method: 'POST', headers: { host, ...(auth ? { authorization: auth } : {}), 'content-type': 'application/json' }, body: JSON.stringify(body) })

afterEach(() => { vi.unstubAllEnvs(); runDryRun.mockClear() })

describe('dry-run route guards', () => {
  it('404s unless DINGHY_DRY_RUN=1', async () => {
    vi.stubEnv('DRY_RUN_TOKEN', TOKEN)
    expect((await POST(req())).status).toBe(404)
  })
  it('404s on a Vercel production deployment and on the production host, even with the flag', async () => {
    vi.stubEnv('DINGHY_DRY_RUN', '1'); vi.stubEnv('DRY_RUN_TOKEN', TOKEN)
    vi.stubEnv('VERCEL_ENV', 'production')
    expect((await POST(req())).status).toBe(404)
    vi.stubEnv('VERCEL_ENV', 'preview')
    expect((await POST(req('www.getdinghy.sh'))).status).toBe(404)
    expect(runDryRun).not.toHaveBeenCalled()
  })
  it('401s without the right bearer token, 400s on a bad body, runs otherwise', async () => {
    vi.stubEnv('DINGHY_DRY_RUN', '1'); vi.stubEnv('DRY_RUN_TOKEN', TOKEN); vi.stubEnv('VERCEL_ENV', 'preview')
    expect((await POST(req(undefined, null))).status).toBe(401)
    expect((await POST(req(undefined, 'Bearer nope'))).status).toBe(401)
    expect((await POST(req(undefined, `Bearer ${TOKEN}`, { scenario: { msg: 'x' } }))).status).toBe(400)
    const ok = await POST(req())
    expect(ok.status).toBe(200)
    expect(runDryRun).toHaveBeenCalledTimes(1)
  })
})
