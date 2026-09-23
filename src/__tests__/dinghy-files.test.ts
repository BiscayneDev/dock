import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const upload = vi.fn()
const createSignedUrl = vi.fn()
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({ storage: { from: () => ({ upload, createSignedUrl }) } }),
}))

import { renderFile } from '@/lib/files/render'
import { fileToolsFor, parseFileInput, FILES_BUCKET } from '@/lib/files/tool'
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

describe('shareable links (here.now)', () => {
  const realFetch = globalThis.fetch
  afterEach(() => {
    globalThis.fetch = realFetch
    delete process.env.HERENOW_API_KEY
  })

  it('does not publish unless share=true', async () => {
    process.env.HERENOW_API_KEY = 'test-key'
    const f = vi.fn()
    globalThis.fetch = f as unknown as typeof fetch
    const set = fileToolsFor()
    await set.tools[0].execute(doc, ctx)
    expect(f).not.toHaveBeenCalled()
    expect(set.files()[0].shareUrl).toBeUndefined()
  })

  it('reports not set up when the key is missing, and still sends the file', async () => {
    const set = fileToolsFor()
    const r = await set.tools[0].execute({ ...doc, share: true }, ctx)
    expect(r.success).toBe(true)
    expect((r.data as Record<string, unknown>).share_error).toMatch(/not set up/)
  })

  it('publishes the HTML page and returns the site url', async () => {
    process.env.HERENOW_API_KEY = 'test-key'
    const calls: Array<{ url: string; init: RequestInit }> = []
    globalThis.fetch = vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init })
      if (url.endsWith('/api/v1/publish'))
        return new Response(JSON.stringify({ slug: 'calm-boat-1a2b', siteUrl: 'https://calm-boat-1a2b.here.now/', upload: { versionId: 'v1', uploads: [{ path: 'index.html', url: 'https://up.example/put', headers: {} }] } }))
      if (url === 'https://up.example/put') return new Response('')
      if (url.endsWith('/finalize')) return new Response(JSON.stringify({ success: true }))
      return new Response('nope', { status: 404 })
    }) as unknown as typeof fetch
    const set = fileToolsFor()
    const r = await set.tools[0].execute({ ...doc, share: true }, ctx)
    expect((r.data as Record<string, unknown>).share_url).toBe('https://calm-boat-1a2b.here.now/')
    expect(set.files()[0].shareUrl).toBe('https://calm-boat-1a2b.here.now/')
    expect(calls.map((c) => c.url)).toEqual([
      'https://here.now/api/v1/publish',
      'https://up.example/put',
      'https://here.now/api/v1/publish/calm-boat-1a2b/finalize',
    ])
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer test-key')
    expect(String(calls[1].init.body ?? '')).not.toBe('')
  })

  it('keeps the attachment when here.now fails', async () => {
    process.env.HERENOW_API_KEY = 'test-key'
    globalThis.fetch = vi.fn(async () => new Response('down', { status: 503 })) as unknown as typeof fetch
    const set = fileToolsFor()
    const r = await set.tools[0].execute({ ...doc, share: true }, ctx)
    expect(r.success).toBe(true)
    expect((r.data as Record<string, unknown>).share_error).toBeTruthy()
    expect(set.files()).toHaveLength(1)
  })
})
