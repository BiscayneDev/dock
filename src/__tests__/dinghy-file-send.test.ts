import { describe, it, expect, vi } from 'vitest'

vi.mock('spectrum-ts', () => ({ attachment: (data: Buffer, o: { name: string; mimeType: string }) => ({ data, ...o }) }))
const renderOgCard = vi.fn((_i: unknown) => ({ arrayBuffer: async () => new Uint8Array([137, 80, 78, 71]).buffer }))
vi.mock('@/lib/brand/og-card', () => ({ renderOgCard: (i: unknown) => renderOgCard(i), clip: (s: string, n: number) => s.slice(0, n) }))

import { pdfPageCount, previewLabel, sendFileWithPreview } from '@/lib/files/send'

const pdf = Buffer.from('%PDF-1.3\n1 0 obj <</Type /Pages /Count 2>>\n2 0 obj <</Type /Page>>\n3 0 obj <</Type/Page>>\n', 'latin1')
const file = { filename: 'plan.pdf', mimeType: 'application/pdf', bytes: pdf, format: 'pdf' as const, title: 'Weekend Plan', subtitle: 'Sat' }

describe('file preview', () => {
  it('counts pages, not the page tree', () => {
    expect(pdfPageCount(pdf)).toBe(2)
    expect(previewLabel('pdf', pdf)).toBe('pdf · 2 pages')
    expect(previewLabel('docx', Buffer.from('PK'))).toBe('word doc')
  })

  it('sends the preview card first, then the file', async () => {
    const sent: Array<{ name: string; mimeType: string }> = []
    const r = await sendFileWithPreview({ send: async (c) => void sent.push(c as { name: string; mimeType: string }) }, file)
    expect(r.preview).toBe(true)
    expect(sent.map((s) => [s.name, s.mimeType])).toEqual([
      ['plan-preview.png', 'image/png'],
      ['plan.pdf', 'application/pdf'],
    ])
    expect(renderOgCard).toHaveBeenCalledWith(expect.objectContaining({ title: 'weekend plan', label: 'pdf · 2 pages', sub: 'Sat' }))
  })

  it('still sends the file when the preview fails', async () => {
    renderOgCard.mockImplementationOnce(() => { throw new Error('satori down') })
    const sent: string[] = []
    const r = await sendFileWithPreview({ send: async (c) => void sent.push((c as { name: string }).name) }, file)
    expect(r.preview).toBe(false)
    expect(sent).toEqual(['plan.pdf'])
  })

  it('skips the preview for csv and markdown', async () => {
    const sent: string[] = []
    await sendFileWithPreview({ send: async (c) => void sent.push((c as { name: string }).name) }, { ...file, filename: 't.csv', format: 'csv', mimeType: 'text/csv' })
    expect(sent).toEqual(['t.csv'])
  })

  it('throws when the file send fails so callers can fall back to a link', async () => {
    let n = 0
    await expect(sendFileWithPreview({ send: async () => { if (n++ === 1) throw new Error('upstream') } }, file)).rejects.toThrow('upstream')
  })
})

import { stripFileMarkers } from '@/lib/files/tool'

describe('file markers', () => {
  it('strips copied "[sent file: x]" markers and flags them', () => {
    const r = stripFileMarkers('Updated itinerary is in your PDF.\n\n[sent file: spain-trip.pdf]')
    expect(r).toEqual({ text: 'Updated itinerary is in your PDF.', hadMarker: true })
    expect(stripFileMarkers('all good')).toEqual({ text: 'all good', hadMarker: false })
  })
})

import { hostedHistoryLine, sendHostedFile } from '@/lib/files/send'

describe('hosted page send', () => {
  const base = { title: 'Heat Schedule', format: 'pdf' as const }
  const priv = { ...base, hosted: { url: 'https://calm-boat-1a2b.here.now/', password: 'k7mq2x9p', expiresAt: '2026-10-24T16:00:00Z', shared: false } }
  const pub = { ...base, hosted: { url: 'https://calm-boat-1a2b.here.now/', expiresAt: '2026-10-24T16:00:00Z', shared: true } }

  it('private: card, then the link alone, then the code alone', async () => {
    const sent: unknown[] = []
    await sendHostedFile({ send: async (c) => void sent.push(c) }, priv)
    expect((sent[0] as { mimeType: string }).mimeType).toBe('image/png')
    expect(sent.slice(1)).toEqual(['https://calm-boat-1a2b.here.now/', 'code: k7mq2x9p'])
    expect(renderOgCard).toHaveBeenLastCalledWith(expect.objectContaining({ label: 'private file · until oct 24', title: 'heat schedule' }))
  })

  it('shared: just the link, so it unfurls into the page card', async () => {
    const sent: unknown[] = []
    await sendHostedFile({ send: async (c) => void sent.push(c) }, pub)
    expect(sent).toEqual(['https://calm-boat-1a2b.here.now/'])
  })

  it('still sends link + code when the card fails', async () => {
    renderOgCard.mockImplementationOnce(() => { throw new Error('satori down') })
    const sent: unknown[] = []
    await sendHostedFile({ send: async (c) => void sent.push(c) }, priv)
    expect(sent).toEqual(['https://calm-boat-1a2b.here.now/', 'code: k7mq2x9p'])
  })

  it('history line keeps the link and code for later share_file calls', () => {
    expect(hostedHistoryLine(priv)).toBe('[file: Heat Schedule] https://calm-boat-1a2b.here.now/ (private, code k7mq2x9p, expires oct 24)')
    expect(hostedHistoryLine(pub)).toContain('shared, anyone with the link')
  })
})
