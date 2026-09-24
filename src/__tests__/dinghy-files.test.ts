import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const upload = vi.fn()
const createSignedUrl = vi.fn()
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

describe('hosted pages (here.now)', () => {
  const realFetch = globalThis.fetch
  afterEach(() => {
    globalThis.fetch = realFetch
    delete process.env.HERENOW_API_KEY
  })

  type Call = { url: string; method: string; body: string }
  function fakeHereNow(opts: { earlyLock?: boolean; lateLock?: boolean } = {}) {
    const calls: Call[] = []
    let finalized = false
    globalThis.fetch = vi.fn(async (url: string, init: RequestInit = {}) => {
      const method = init.method ?? 'GET'
      const body = typeof init.body === 'string' ? init.body : ''
      calls.push({ url, method, body })
      if (url.endsWith('/api/v1/publish') && method === 'POST') {
        const files = JSON.parse(body).files as Array<{ path: string }>
        return new Response(JSON.stringify({ slug: 'calm-boat-1a2b', siteUrl: 'https://calm-boat-1a2b.here.now/', upload: { versionId: 'v1', uploads: files.map((f) => ({ path: f.path, url: `https://up.example/${f.path}`, headers: {} })) } }))
      }
      if (url.startsWith('https://up.example/')) return new Response('')
      if (url.endsWith('/metadata')) {
        const ok = finalized ? opts.lateLock !== false : opts.earlyLock !== false
        return ok ? new Response('{}') : new Response('no', { status: 409 })
      }
      if (url.endsWith('/finalize')) { finalized = true; return new Response('{"success":true}') }
      if (method === 'DELETE') return new Response('')
      return new Response('nope', { status: 404 })
    }) as unknown as typeof fetch
    return calls
  }
  const paths = (calls: Call[]) => calls.map((c) => `${c.method} ${c.url.replace('https://here.now/api/v1', '')}`)

  it('attaches as before when hosting is not set up', async () => {
    const set = fileToolsFor()
    expect(set.tools.map((t) => t.name)).toEqual(['create_file'])
    const r = await set.tools[0].execute(doc, ctx)
    expect((r.data as Record<string, unknown>).delivery).toBe('attachment')
    expect(set.files()[0].hosted).toBeUndefined()
  })

  it('defaults to a private page: password set before it goes live, pdf alongside, ttl + owner tag', async () => {
    process.env.HERENOW_API_KEY = 'test-key'
    const calls = fakeHereNow()
    const set = fileToolsFor()
    expect(set.tools.map((t) => t.name)).toEqual(['create_file', 'share_file'])
    const r = await set.tools[0].execute(doc, ctx)
    expect((r.data as Record<string, unknown>).delivery).toBe('private_file')
    expect(JSON.stringify(r.data)).not.toContain('here.now')
    expect(paths(calls)).toEqual([
      'POST /publish',
      'PUT https://up.example/index.html',
      'PUT https://up.example/weekend-in-key-biscayne.pdf',
      'PATCH /publish/calm-boat-1a2b/metadata',
      'POST /publish/calm-boat-1a2b/finalize',
    ])
    const create = JSON.parse(calls[0].body)
    expect(create.ttlSeconds).toBe(30 * 86_400)
    expect(create.displayDescription).toMatch(/^dinghy file · owner [0-9a-f]{16}$/)
    expect(create.displayDescription).not.toContain('u1')
    const pw = JSON.parse(calls[3].body).password
    expect(pw).toMatch(/^[a-z2-9]{8}$/)
    const f = set.files()[0]
    expect(f.hosted).toMatchObject({ url: 'https://calm-boat-1a2b.here.now/', password: pw, shared: false })
    expect(upload).not.toHaveBeenCalled()
  })

  it('page links the pdf download and uses the per-file card', async () => {
    process.env.HERENOW_API_KEY = 'test-key'
    const bodies: Record<string, string> = {}
    const calls = fakeHereNow()
    const orig = globalThis.fetch
    globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
      if (url.startsWith('https://up.example/') && init.body instanceof Uint8Array) bodies[url] = Buffer.from(init.body).toString('latin1')
      return orig(url, init)
    }) as unknown as typeof fetch
    await fileToolsFor().tools[0].execute(doc, ctx)
    const html = bodies['https://up.example/index.html']
    expect(html).toContain('href="weekend-in-key-biscayne.pdf" download')
    expect(html).toContain('getdinghy.sh/api/og/file?title=Weekend+in+Key+Biscayne')
    expect(bodies['https://up.example/weekend-in-key-biscayne.pdf'].startsWith('%PDF-')).toBe(true)
    expect(calls.length).toBeGreaterThan(0)
  })

  it('locks right after finalize if the early lock is refused', async () => {
    process.env.HERENOW_API_KEY = 'test-key'
    const calls = fakeHereNow({ earlyLock: false })
    const set = fileToolsFor()
    await set.tools[0].execute(doc, ctx)
    expect(paths(calls).slice(-3)).toEqual(['PATCH /publish/calm-boat-1a2b/metadata', 'POST /publish/calm-boat-1a2b/finalize', 'PATCH /publish/calm-boat-1a2b/metadata'])
    expect(set.files()[0].hosted?.password).toBeTruthy()
  })

  it('deletes the site and falls back to the attachment if it cannot be locked', async () => {
    process.env.HERENOW_API_KEY = 'test-key'
    const calls = fakeHereNow({ earlyLock: false, lateLock: false })
    const set = fileToolsFor()
    const r = await set.tools[0].execute(doc, ctx)
    expect(paths(calls)).toContain('DELETE /publish/calm-boat-1a2b')
    expect((r.data as Record<string, unknown>).delivery).toBe('attachment')
    expect(set.files()[0].hosted).toBeUndefined()
    expect(set.files()[0].format).toBe('pdf')
  })

  it('share=true publishes without a password', async () => {
    process.env.HERENOW_API_KEY = 'test-key'
    const calls = fakeHereNow()
    const set = fileToolsFor()
    const r = await set.tools[0].execute({ ...doc, share: true }, ctx)
    expect((r.data as Record<string, unknown>).delivery).toBe('shared_file')
    expect(paths(calls).some((p) => p.endsWith('/metadata'))).toBe(false)
    expect(set.files()[0].hosted).toMatchObject({ shared: true })
    expect(set.files()[0].hosted?.password).toBeUndefined()
  })

  it('attach=true and docx/csv skip hosting', async () => {
    process.env.HERENOW_API_KEY = 'test-key'
    const calls = fakeHereNow()
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

describe('share_file', () => {
  const realFetch = globalThis.fetch
  afterEach(() => {
    globalThis.fetch = realFetch
    delete process.env.HERENOW_API_KEY
  })
  function site(owner: string) {
    const patches: string[] = []
    globalThis.fetch = vi.fn(async (url: string, init: RequestInit = {}) => {
      if ((init.method ?? 'GET') === 'GET') return new Response(JSON.stringify({ slug: 'calm-boat-1a2b', siteUrl: 'https://calm-boat-1a2b.here.now/', displayDescription: `dinghy file · owner ${owner}`, expiresAt: '2026-10-24T00:00:00Z' }))
      patches.push(String(init.body))
      return new Response('{}')
    }) as unknown as typeof fetch
    return patches
  }
  const share = () => fileToolsFor().tools[1]

  it('shares a page this user made by dropping the password', async () => {
    process.env.HERENOW_API_KEY = 'test-key'
    const patches = site(ownerTag('u1'))
    const r = await share().execute({ link: 'https://calm-boat-1a2b.here.now/', share: true }, ctx)
    expect(r.success).toBe(true)
    expect(patches).toEqual(['{"password":null}'])
  })

  it('makes it private again with a new code', async () => {
    process.env.HERENOW_API_KEY = 'test-key'
    const patches = site(ownerTag('u1'))
    const r = await share().execute({ link: 'calm-boat-1a2b', share: false }, ctx)
    expect((r.data as Record<string, unknown>).code).toMatch(/^[a-z2-9]{8}$/)
    expect(JSON.parse(patches[0]).password).toBe((r.data as Record<string, unknown>).code)
  })

  it("refuses someone else's page and non-here.now links", async () => {
    process.env.HERENOW_API_KEY = 'test-key'
    const patches = site(ownerTag('someone-else'))
    expect((await share().execute({ link: 'https://calm-boat-1a2b.here.now/', share: true }, ctx)).success).toBe(false)
    expect((await share().execute({ link: 'https://evil.example/x', share: true }, ctx)).success).toBe(false)
    expect(patches).toHaveLength(0)
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
