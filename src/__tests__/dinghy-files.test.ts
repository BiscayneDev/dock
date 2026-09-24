import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const upload = vi.fn()
const createSignedUrl = vi.fn()
const { rememberFile, findFile } = vi.hoisted(() => ({ rememberFile: vi.fn(async (...args: unknown[]) => void args), findFile: vi.fn() }))
vi.mock('@/lib/spectrum/plans', () => ({ rememberFile, findFile }))
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({ storage: { from: () => ({ upload, createSignedUrl }) } }),
}))

import { renderFile } from '@/lib/files/render'
import { fileToolsFor, parseFileInput, FILES_BUCKET } from '@/lib/files/tool'
import { ownerTag, slugFrom } from '@/lib/files/share'
import type { UserContext } from '@/lib/llm/types'

const ctx = { userId: 'u1', tokens: {} } as unknown as UserContext
const doc = {
  title: 'Weekend in Key Biscayne',
  subtitle: 'Halsey + Pia',
  body: '## Saturday\n- 09:00 Coffee on **Crandon Beach**\n- 12:30 Lunch\n\n| Item | Cost |\n| --- | --- |\n| Boards | $60 |\n\n> Launch before 4.',
}

beforeEach(() => {
  upload.mockReset().mockResolvedValue({ data: { path: 'p' }, error: null })
  createSignedUrl.mockReset().mockResolvedValue({ data: { signedUrl: 'https://sb.example/signed' }, error: null })
})

describe('parseFileInput', () => {
  it('defaults to pdf and maps friendly names', () => {
    expect(parseFileInput({ title: 'A', body: 'x' })).toMatchObject({ format: 'pdf' })
    expect(parseFileInput({ title: 'A', body: 'x', format: 'Word' })).toMatchObject({ format: 'docx' })
    expect(parseFileInput({ title: 'A', body: 'x', format: 'markdown' })).toMatchObject({ format: 'md' })
  })
  it('rejects missing fields, bad formats and oversize input', () => {
    expect(parseFileInput({ body: 'x' })).toHaveProperty('error')
    expect(parseFileInput({ title: 'A', body: '  ' })).toHaveProperty('error')
    expect(parseFileInput({ title: 'A', body: 'x', format: 'exe' })).toHaveProperty('error')
    expect(parseFileInput({ title: 'A', body: 'x'.repeat(60_001) })).toHaveProperty('error')
  })
})

describe('renderFile', () => {
  it('renders a real PDF', async () => {
    const f = await renderFile(doc, 'pdf')
    expect(f.filename).toBe('weekend-in-key-biscayne.pdf')
    expect(f.mimeType).toBe('application/pdf')
    expect(f.bytes.subarray(0, 5).toString()).toBe('%PDF-')
  })
  it('renders a real DOCX (zip)', async () => {
    const f = await renderFile(doc, 'docx')
    expect(f.bytes.subarray(0, 2).toString()).toBe('PK')
  })
  it('renders a self-contained HTML page with the brand fonts embedded', async () => {
    const f = await renderFile(doc, 'html', { ogImage: 'https://www.getdinghy.sh/api/og' })
    const html = f.bytes.toString()
    expect(html).toContain('<h1>Weekend in Key Biscayne</h1>')
    expect(html).toContain("font-family:'Fraunces'")
    expect(html).not.toContain('fonts.googleapis.com')
    expect(html).toContain('og:image')
  })
  it('escapes HTML in the title', async () => {
    const f = await renderFile({ title: '<script>x</script>', body: 'hi' }, 'html')
    expect(f.bytes.toString()).not.toContain('<script>x</script>')
  })
})

describe('create_file tool', () => {
  it('renders, stores privately and queues the file for sending', async () => {
    const set = fileToolsFor()
    const r = await set.tools[0].execute({ ...doc, format: 'pdf' }, ctx)
    expect(r.success).toBe(true)
    expect(upload).toHaveBeenCalledOnce()
    expect(upload.mock.calls[0][0]).toMatch(/^u1\/[0-9a-f-]+\/weekend-in-key-biscayne\.pdf$/)
    const files = set.files()
    expect(files).toHaveLength(1)
    expect(files[0]).toMatchObject({ format: 'pdf', link: 'https://sb.example/signed' })
    expect(FILES_BUCKET).toBe('dinghy-files')
  })
  it('still sends the attachment when storage fails (no link)', async () => {
    upload.mockResolvedValue({ data: null, error: new Error('bucket missing') })
    const set = fileToolsFor()
    const r = await set.tools[0].execute(doc, ctx)
    expect(r.success).toBe(true)
    expect(set.files()[0].link).toBeNull()
  })
  it('caps files per reply and reports bad input', async () => {
    const set = fileToolsFor()
    for (let i = 0; i < 3; i++) expect((await set.tools[0].execute(doc, ctx)).success).toBe(true)
    expect((await set.tools[0].execute(doc, ctx)).success).toBe(false)
    expect((await fileToolsFor().tools[0].execute({ title: '' }, ctx)).success).toBe(false)
  })
})

describe('file links (here.now)', () => {
  const realFetch = globalThis.fetch
  afterEach(() => {
    globalThis.fetch = realFetch
    delete process.env.HERENOW_API_KEY
  })

  type Call = { url: string; method: string; body: string }
  function fakeHereNow() {
    const calls: Call[] = []
    const bodies: Record<string, string> = {}
    globalThis.fetch = vi.fn(async (url: string, init: RequestInit = {}) => {
      const method = init.method ?? 'GET'
      const body = typeof init.body === 'string' ? init.body : ''
      calls.push({ url, method, body })
      if (url.startsWith('https://up.example/') && init.body instanceof Uint8Array) bodies[url] = Buffer.from(init.body).toString('latin1')
      if (url.endsWith('/api/v1/publish') && method === 'POST') {
        const files = JSON.parse(body).files as Array<{ path: string }>
        return new Response(JSON.stringify({ slug: 'calm-boat-1a2b', siteUrl: 'https://calm-boat-1a2b.here.now/', upload: { versionId: 'v1', uploads: files.map((f) => ({ path: f.path, url: `https://up.example/${f.path}`, headers: {} })) } }))
      }
      if (url.startsWith('https://up.example/')) return new Response('')
      if (url.endsWith('/finalize')) return new Response('{"success":true}')
      return new Response('nope', { status: 404 })
    }) as unknown as typeof fetch
    return { calls, bodies }
  }
  const paths = (calls: Call[]) => calls.map((c) => `${c.method} ${c.url.replace('https://here.now/api/v1', '')}`)

  it('attaches as before when hosting is not set up', async () => {
    const set = fileToolsFor()
    expect(set.tools.map((t) => t.name)).toEqual(['create_file', 'recall_file'])
    const r = await set.tools[0].execute(doc, ctx)
    expect((r.data as Record<string, unknown>).delivery).toBe('attachment')
    expect(set.files()[0].hosted).toBeUndefined()
  })

  it('defaults to an open file link: no password anywhere, pdf alongside, 7-day ttl, owner tag', async () => {
    process.env.HERENOW_API_KEY = 'test-key'
    const { calls } = fakeHereNow()
    const set = fileToolsFor()
    expect(set.tools.map((t) => t.name)).toEqual(['create_file', 'recall_file', 'revoke_file'])
    const r = await set.tools[0].execute(doc, ctx)
    expect((r.data as Record<string, unknown>).delivery).toBe('file_link')
    expect(JSON.stringify(r.data)).not.toContain('here.now')
    expect(paths(calls)).toEqual([
      'POST /publish',
      'PUT https://up.example/index.html',
      'PUT https://up.example/weekend-in-key-biscayne.pdf',
      'POST /publish/calm-boat-1a2b/finalize',
    ])
    expect(calls.some((c) => c.url.endsWith('/metadata') || c.body.includes('password'))).toBe(false)
    const create = JSON.parse(calls[0].body)
    expect(create.ttlSeconds).toBe(7 * 86_400)
    expect(create.displayDescription).toMatch(/^dinghy file · owner [0-9a-f]{16}$/)
    expect(create.displayDescription).not.toContain('u1')
    expect(set.files()[0].hosted).toMatchObject({ url: 'https://calm-boat-1a2b.here.now/' })
    expect(upload).not.toHaveBeenCalled()
  })

  it('page is noindex, links the pdf download and uses the per-file card', async () => {
    process.env.HERENOW_API_KEY = 'test-key'
    const { bodies } = fakeHereNow()
    await fileToolsFor().tools[0].execute(doc, ctx)
    const html = bodies['https://up.example/index.html']
    expect(html).toContain('<meta name="robots" content="noindex">')
    expect(html).toContain('href="weekend-in-key-biscayne.pdf" download')
    expect(html).toContain('getdinghy.sh/api/og/file?title=Weekend+in+Key+Biscayne')
    expect(bodies['https://up.example/weekend-in-key-biscayne.pdf'].startsWith('%PDF-')).toBe(true)
  })

  it('attach=true and docx/csv skip hosting', async () => {
    process.env.HERENOW_API_KEY = 'test-key'
    const { calls } = fakeHereNow()
    const set = fileToolsFor()
    await set.tools[0].execute({ ...doc, attach: true }, ctx)
    await set.tools[0].execute({ ...doc, format: 'docx' }, ctx)
    await set.tools[0].execute({ ...doc, format: 'csv' }, ctx)
    expect(calls).toHaveLength(0)
    expect(set.files().map((f) => [f.format, Boolean(f.hosted)])).toEqual([['pdf', false], ['docx', false], ['csv', false]])
  })

  it('falls back to the attachment when here.now is down', async () => {
    process.env.HERENOW_API_KEY = 'test-key'
    globalThis.fetch = vi.fn(async () => new Response('down', { status: 503 })) as unknown as typeof fetch
    const set = fileToolsFor()
    const r = await set.tools[0].execute(doc, ctx)
    expect(r.success).toBe(true)
    expect((r.data as Record<string, unknown>).page_error).toBeTruthy()
    expect(set.files()[0].hosted).toBeUndefined()
  })
})

describe('revoke_file', () => {
  const realFetch = globalThis.fetch
  afterEach(() => {
    globalThis.fetch = realFetch
    delete process.env.HERENOW_API_KEY
  })
  function site(owner: string) {
    const writes: string[] = []
    globalThis.fetch = vi.fn(async (url: string, init: RequestInit = {}) => {
      const method = init.method ?? 'GET'
      if (method === 'GET') return new Response(JSON.stringify({ slug: 'calm-boat-1a2b', siteUrl: 'https://calm-boat-1a2b.here.now/', displayName: 'Heat', displayDescription: `dinghy file · owner ${owner}` }))
      writes.push(`${method} ${url}`)
      return new Response('')
    }) as unknown as typeof fetch
    return writes
  }
  const revoke = () => fileToolsFor().tools.find((t) => t.name === 'revoke_file')!

  it('deletes a file this user made', async () => {
    process.env.HERENOW_API_KEY = 'test-key'
    const writes = site(ownerTag('u1'))
    const r = await revoke().execute({ link: 'https://calm-boat-1a2b.here.now/' }, ctx)
    expect(r.success).toBe(true)
    expect(writes).toEqual(['DELETE https://here.now/api/v1/publish/calm-boat-1a2b'])
  })

  it("refuses someone else's file and non-here.now links", async () => {
    process.env.HERENOW_API_KEY = 'test-key'
    const writes = site(ownerTag('someone-else'))
    expect((await revoke().execute({ link: 'https://calm-boat-1a2b.here.now/' }, ctx)).success).toBe(false)
    expect((await revoke().execute({ link: 'https://evil.example/x' }, ctx)).success).toBe(false)
    expect(writes).toHaveLength(0)
  })
})

describe('slugFrom', () => {
  it('parses here.now links and bare slugs only', () => {
    expect(slugFrom('https://calm-boat-1a2b.here.now/')).toBe('calm-boat-1a2b')
    expect(slugFrom('calm-boat-1a2b')).toBe('calm-boat-1a2b')
    expect(slugFrom('https://calm-boat-1a2b.here.now.evil.com/')).toBeNull()
    expect(slugFrom('https://x.example/')).toBeNull()
  })
})

describe('file memory', () => {
  it('create_file saves the file with its markdown for the bound user', async () => {
    rememberFile.mockClear()
    const set = fileToolsFor()
    expect((await set.tools[0].execute({ ...doc, format: 'pdf', attach: true }, ctx)).success).toBe(true)
    expect(rememberFile).toHaveBeenCalledOnce()
    const [userId, , rec] = rememberFile.mock.calls[0] as unknown as [string, null, { title: string; markdown: string }]
    expect(userId).toBe('u1')
    expect(rec.title).toBe(doc.title)
    expect(rec.markdown).toBe(doc.body)
  })

  it('skips memory for unbound chats', async () => {
    rememberFile.mockClear()
    await fileToolsFor().tools[0].execute({ ...doc, format: 'pdf', attach: true }, { tokens: {} } as unknown as UserContext)
    expect(rememberFile).not.toHaveBeenCalled()
  })

  it('recall_file returns the saved markdown', async () => {
    findFile.mockResolvedValueOnce({ title: 'Spain itinerary', format: 'page', url: 'https://x.here.now', markdown: '# Day 1', expires_at: null, created_at: '2026-09-24' })
    const recall = fileToolsFor().tools.find((t) => t.name === 'recall_file')!
    const r = await recall.execute({ query: 'spain' }, ctx)
    expect(r).toMatchObject({ success: true, data: { title: 'Spain itinerary', body: '# Day 1' } })
    findFile.mockResolvedValueOnce(null)
    expect((await recall.execute({ query: 'tokyo' }, ctx)).success).toBe(false)
    expect((await recall.execute({}, ctx)).success).toBe(false)
  })
})
