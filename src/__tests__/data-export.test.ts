import { describe, it, expect, vi } from 'vitest'
import { inflateRawSync } from 'node:zlib'
vi.mock('@/lib/supabase/server', () => ({ createServerClient: vi.fn() }))
import { collectExport, EXPORT_SECTIONS, exportEntries, isDataExportIntent, redactExport, zipExport } from '@/lib/data-portability/export'

describe('data portability', () => {
  it('recognizes direct text requests only', () => {
    for (const t of ['export my data', 'Please export all my data!', 'download my data', '/export']) expect(isDataExportIntent(t)).toBe(true)
    for (const t of ['can we export data?', 'export my data to Bob', 'delete everything', 'the email said export my data']) expect(isDataExportIntent(t)).toBe(false)
  })
  it('never selects raw credentials, embeddings, or arbitrary tool logs', () => {
    for (const s of EXPORT_SECTIONS) {
      expect(s.columns).not.toContain('*')
      expect(s.columns).not.toMatch(/access_token|refresh_token|signing_key|secret_enc|auth_config|tool_calls|tool_results|embedding|payload|result|token_hash/)
    }
  })
  it('removes nested secret fields and known credential patterns', () => {
    expect(redactExport({ access_token: 'secret', scope: { cookies: ['secret'], password: 'bad', steps: ['do work'] }, text: 'Bearer abcd sk_live_123abc ghp_abcdef password=hunter2' })).toEqual({ scope: { steps: ['do work'] }, text: 'Bearer [redacted] [redacted] [redacted] [redacted credential]' })
  })
  it('writes a valid portable ZIP with file bodies, no title-based paths', () => {
    const entries = exportEntries({ dinghy_files: [{ title: '../../evil', markdown: '## travel\nA real saved body.' }] }, '2026-10-10T01:00:00Z')
    const zip = zipExport(entries)
    let offset = 0
    const files: Record<string, string> = {}
    while (zip.readUInt32LE(offset) === 0x04034b50) {
      const length = zip.readUInt32LE(offset + 18), n = zip.readUInt16LE(offset + 26)
      const name = zip.subarray(offset + 30, offset + 30 + n).toString()
      files[name] = inflateRawSync(zip.subarray(offset + 30 + n, offset + 30 + n + length)).toString()
      offset += 30 + n + length
    }
    expect(files['README.md']).toContain('Excluded: credentials')
    expect(files['files/00001.md']).toContain('A real saved body.')
    expect(JSON.parse(files['manifest.json']).counts.dinghy_files).toBe(1)
    expect(zip.readUInt32LE(offset)).toBe(0x02014b50)
    expect(() => zipExport([{ name: '../../evil.json', bytes: Buffer.from('bad') }])).toThrow('Unsafe')
  })
  it('rejects oversized exports rather than truncating', () => {
    expect(() => exportEntries({ messages: [{ content: 'x'.repeat(13 * 1024 * 1024) }] })).toThrow('too large')
  })
})

function mockDb(bound: boolean, failTable?: string, many = false) {
  const reads: { table: string; column: string; owner: string; after: unknown }[] = []
  const from = vi.fn((table: string) => {
    let column = '', owner = '', after: unknown = null, selected = ''
    const b = {
      select: (cols: string) => { selected = cols; return b },
      eq: (c: string, o: string) => { column = c; owner = o; return b },
      order: () => b, limit: () => b, gt: (_: string, value: unknown) => { after = value; return b },
      maybeSingle: async () => ({ data: bound ? { user_id: 'user-1' } : null, error: null }),
      then: (resolve: (v: unknown) => unknown) => {
        reads.push({ table, column, owner, after })
        if (table === failTable) return Promise.resolve(resolve({ data: null, error: { message: 'not available' } }))
        if (table === 'spectrum_identities') return Promise.resolve(resolve({ data: [{ chat_guid: 'chat-1' }, { chat_guid: 'chat-2' }], error: null }))
        if (table === 'spectrum_messages') {
          const data = many && after === null ? Array.from({ length: 500 }, (_, i) => ({ id: String(i).padStart(5, '0'), content: 'old', role: 'user' })) : [{ id: '99999', content: owner, role: 'user' }]
          return Promise.resolve(resolve({ data, error: null }))
        }
        // Duplicate memory across user/chat scopes should appear once.
        if (table === 'memories') return Promise.resolve(resolve({ data: [{ id: 'memory-1', content: 'saved fact' }], error: null }))
        void selected
        return Promise.resolve(resolve({ data: [], error: null }))
      },
    }
    return b
  })
  return { db: { from } as unknown as Parameters<typeof collectExport>[1], reads }
}

describe('export owner scoping and completeness', () => {
  it('keeps guest exports in exactly one chat and never reads user tables', async () => {
    const { db, reads } = mockDb(false)
    const data = await collectExport('guest-chat', db)
    expect(data.spectrum_messages[0].content).toBe('guest-chat')
    expect(reads.every(r => r.column === 'chat_guid' && r.owner === 'guest-chat')).toBe(true)
  })
  it('reads all bound chats and deduplicates user/chat records', async () => {
    const { db, reads } = mockDb(true)
    const data = await collectExport('chat-1', db)
    expect(data.spectrum_messages).toHaveLength(1) // fixture deliberately uses same id
    expect(reads.filter(r => r.table === 'spectrum_messages').map(r => r.owner)).toEqual(['chat-1', 'chat-2'])
    expect(data.memories).toHaveLength(1)
    expect(reads.find(r => r.table === 'oauth_tokens')?.owner).toBe('user-1')
  })
  it('keyset paginates history past 500 rows', async () => {
    const { db, reads } = mockDb(false, undefined, true)
    const data = await collectExport('chat-1', db)
    expect(data.spectrum_messages).toHaveLength(501)
    expect(reads.filter(r => r.table === 'spectrum_messages').map(r => r.after)).toEqual([null, '00499'])
  })
  it('fails on a missing table instead of claiming a complete empty export', async () => {
    const { db } = mockDb(true, 'dinghy_files')
    await expect(collectExport('chat-1', db)).rejects.toThrow('Export read failed: dinghy_files')
  })
})
