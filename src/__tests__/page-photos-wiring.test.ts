import { describe, it, expect, vi, beforeEach } from 'vitest'

const { publishSite, attachPhotos } = vi.hoisted(() => ({
  publishSite: vi.fn(async (files: { path: string }[]) => ({ url: 'https://harbor-test.here.now/', slug: 'harbor-test', expiresAt: '2030-01-01T00:00:00Z', files })),
  attachPhotos: vi.fn(),
}))
vi.mock('@/lib/spectrum/plans', () => ({ rememberFile: vi.fn(async () => undefined), findFile: vi.fn() }))
vi.mock('@/lib/spectrum/line-for-chat', () => ({ dinghyLineFor: vi.fn(async () => '+10000000000') }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => ({}) }))
vi.mock('@/lib/files/share', () => ({ publishSite, shareEnabled: () => true, revokeSite: vi.fn(), slugFrom: vi.fn() }))
vi.mock('@/lib/files/photos', () => ({ attachPhotos }))

import { fileToolsFor } from '@/lib/files/tool'
import type { UserContext } from '@/lib/llm/types'

const input = { title: 'Harbor stays', format: 'pdf', body: ':::stay\nHarbor Inn | $120 | 8.8 | Old town | Thin walls | | https://example.test/i\n:::' }
const ctx = (photosOk?: boolean) => ({ userId: 'u1', tokens: {}, ...(photosOk === undefined ? {} : { photosOk }) }) as unknown as UserContext

beforeEach(() => {
  publishSite.mockClear()
  attachPhotos.mockReset().mockImplementation(async (body: string, o: { allowed: boolean }) => ({
    body: o.allowed ? `${body}\n\nPhoto credits: Harbor Inn: Sam Example, CC BY 4.0` : body,
    photos: o.allowed ? [{ path: 'img/p-abc123abc123.jpg', bytes: Buffer.from([1, 2, 3]), contentType: 'image/jpeg', credit: 'Sam Example', license: 'CC BY 4.0' }] : [],
  }))
})

describe('create_file photo wiring', () => {
  it('asks for photos only when the turn is marked clean, and ships them as site files', async () => {
    const tool = fileToolsFor().tools.find((t) => t.name === 'create_file')!
    await tool.execute(input, ctx(true))
    expect(attachPhotos.mock.calls[0][1]).toMatchObject({ allowed: true })
    const paths = (publishSite.mock.calls[0][0] as { path: string }[]).map((f) => f.path)
    expect(paths).toContain('img/p-abc123abc123.jpg')
  })

  it('does not allow photo lookups when the flag is missing or false', async () => {
    const tool = fileToolsFor().tools.find((t) => t.name === 'create_file')!
    await tool.execute(input, ctx())
    await tool.execute(input, ctx(false))
    expect(attachPhotos.mock.calls.map((c) => c[1].allowed)).toEqual([false, false])
    expect((publishSite.mock.calls[0][0] as { path: string }[]).map((f) => f.path)).not.toContain('img/p-abc123abc123.jpg')
  })
})
