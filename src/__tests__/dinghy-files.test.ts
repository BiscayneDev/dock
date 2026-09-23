import { describe, it, expect, vi, beforeEach } from 'vitest'

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
