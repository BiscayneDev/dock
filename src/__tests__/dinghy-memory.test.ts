import { describe, it, expect, vi, beforeEach } from 'vitest'

const rpcMock = vi.fn()
const fromMock = vi.fn()
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({ rpc: rpcMock, from: fromMock }),
}))
const embedMock = vi.fn(async (t: string): Promise<number[] | null> => (t ? null : null))
vi.mock('@/lib/memory/embeddings', () => ({
  embedText: (t: string) => embedMock(t),
  currentEmbeddingModel: () => 'test-model',
}))

// spectrum_identities lookup: by default resolves to NO bound user (guest chat).
// Tests set a bound user via mockIdentity(userId).
let identity: { data: { user_id: string }[] | null; error: unknown } = { data: [], error: null }
function identityQuery() {
  const q = {
    select: () => q,
    eq: () => q,
    not: () => q,
    limit: () => Promise.resolve(identity),
  }
  return q
}

import {
  cleanFacts,
  cleanProfile,
  loadMemoryContext,
  mergeFacts,
  backfillEmbeddings,
  resolveUserId,
  withTimeout,
  looksSecret,
  parseJsonObject,
  renderMemoryBlock,
  updateMemory,
} from '@/lib/spectrum/memory'

beforeEach(() => {
  rpcMock.mockReset()
  fromMock.mockReset()
  fromMock.mockReturnValue(identityQuery())
  identity = { data: [], error: null }
})

describe('looksSecret', () => {
  it('flags credentials and numbers', () => {
    for (const s of [
      'my key is sk-abcdefghijklmnop1234',
      'ghp_abcdefghijklmnopqrstuvwxyz0123',
      'card 4242 4242 4242 4242',
      'my password is hunter2',
      'ssn 123-45-6789',
      'seed phrase is on my desk',
      'deadbeefdeadbeefdeadbeefdeadbeef00',
    ]) expect(looksSecret(s)).toBe(true)
  })
  it('lets ordinary facts through', () => {
    for (const s of ['Halsey lives in Miami', 'prefers morning meetings', 'flight to NYC on Oct 3 at 7:40pm'])
      expect(looksSecret(s)).toBe(false)
  })
})

describe('cleanFacts', () => {
  it('drops secrets, dupes, bad types and caps at 5', () => {
    const out = cleanFacts(
      [
        { content: 'Likes sushi', type: 'preference' },
        { content: 'likes sushi', type: 'preference' },
        { content: 'Known already', type: 'fact' },
        { content: 'password is abc123', type: 'fact' },
        { content: 'Works at Biscayne', type: 'weird' },
        { content: 'a', type: 'fact' },
        { content: 'f3', type: 'fact' },
        { content: 'f4 fact', type: 'fact' },
        { content: 'f5 fact', type: 'fact' },
        { content: 'f6 fact', type: 'fact' },
      ],
      ['known already'],
    )
    expect(out.map((f) => f.content)).toEqual(['Likes sushi', 'Works at Biscayne', 'f4 fact', 'f5 fact', 'f6 fact'])
    expect(out[1].type).toBe('fact')
  })
  it('ignores non-arrays', () => expect(cleanFacts('nope', [])).toEqual([]))
})

describe('cleanProfile', () => {
  it('strips secret lines and caps length', () => {
    expect(cleanProfile('- name: Halsey\n- api key sk-abcdefghijklmnop1234\n- lives in Miami')).toBe('- name: Halsey\n- lives in Miami')
    expect(cleanProfile('x'.repeat(5000))!.length).toBe(1200)
    expect(cleanProfile(42)).toBeNull()
  })
})

describe('parseJsonObject', () => {
  it('pulls JSON out of chatter', () => {
    expect(parseJsonObject('sure: {"summary":"hi"} done')).toEqual({ summary: 'hi' })
    expect(parseJsonObject('no json')).toBeNull()
  })
})

describe('renderMemoryBlock', () => {
  it('is empty when nothing is known', () => {
    expect(renderMemoryBlock({ profile: '', summaries: [], facts: [] })).toBe('')
  })
  it('renders all three layers', () => {
    const b = renderMemoryBlock({ profile: '- name: Halsey', summaries: ['talked about the launch'], facts: ['likes sushi'] })
    expect(b).toContain('- name: Halsey')
    expect(b).toContain('talked about the launch')
    expect(b).toContain('likes sushi')
    expect(b).toContain('trust what they say now')
  })
})

describe('loadMemoryContext', () => {
  it('falls back to newest facts without embeddings', async () => {
    rpcMock.mockImplementation((fn: string) => {
      if (fn === 'dinghy_memory_context') return Promise.resolve({ data: { profile: 'p', summaries: ['s'] }, error: null })
      if (fn === 'recent_chat_memories') return Promise.resolve({ data: [{ content: 'f1' }], error: null })
      return Promise.resolve({ data: null, error: null })
    })
    expect(await loadMemoryContext('chat-1', 'hello there')).toEqual({ profile: 'p', summaries: ['s'], facts: ['f1'] })
  })
})

describe('resolveUserId', () => {
  it('returns the bound user id', async () => {
    identity = { data: [{ user_id: 'u-1' }], error: null }
    await expect(resolveUserId('chat-9')).resolves.toBe('u-1')
  })
  it('returns null for guest chats and on lookup errors', async () => {
    await expect(resolveUserId('guest-chat')).resolves.toBeNull()
    identity = { data: null, error: { message: 'boom' } }
    await expect(resolveUserId('chat-9')).resolves.toBeNull()
  })
})

describe('updateMemory', () => {
  it('is a no-op when no update is due (guest chat keeps chat_guid claim)', async () => {
    rpcMock.mockResolvedValue({ data: [], error: null })
    await updateMemory('chat-1')
    expect(rpcMock).toHaveBeenCalledTimes(1)
    expect(rpcMock).toHaveBeenCalledWith('claim_memory_update', { p_chat_guid: 'chat-1', p_every: 4 })
  })
  it('is a no-op when no update is due (bound chat claims at user level)', async () => {
    identity = { data: [{ user_id: 'u-1' }], error: null }
    rpcMock.mockResolvedValue({ data: [], error: null })
    await updateMemory('chat-1')
    expect(rpcMock).toHaveBeenCalledTimes(1)
    expect(rpcMock).toHaveBeenCalledWith('claim_user_memory_update', { p_user_id: 'u-1', p_chat_guid: 'chat-1', p_every: 4 })
  })
})


describe('embeddings recall', () => {
  it('ranks matches first, tops up with recent, dedupes, drops weak matches', () => {
    const out = mergeFacts(
      [
        { content: 'Loves kitesurfing at Crandon', similarity: 0.8 },
        { content: 'Weak match', similarity: 0.1 },
      ],
      ['loves kitesurfing at crandon', 'Sister is Pia', 'Works at Biscayne Ventures'],
      3
    )
    expect(out).toEqual(['Loves kitesurfing at Crandon', 'Sister is Pia', 'Works at Biscayne Ventures'])
  })

  it('pulls relevant older summaries ahead of the latest two', async () => {
    embedMock.mockResolvedValueOnce([0.1, 0.2])
    rpcMock.mockImplementation(async (name: string) => {
      if (name === 'dinghy_memory_context') return { data: { profile: '- Halsey', summaries: ['recent A', 'recent B'] }, error: null }
      if (name === 'match_chat_summaries')
        return { data: [{ summary: 'Costa Brava trip planning', last_at: '2026-09-01T00:00:00Z', similarity: 0.7 }, { summary: 'unrelated', last_at: '2026-09-02T00:00:00Z', similarity: 0.1 }], error: null }
      if (name === 'match_chat_memories') return { data: [{ content: 'Flying to Barcelona Oct 3', similarity: 0.6 }], error: null }
      if (name === 'recent_chat_memories') return { data: [{ content: 'Sister is Pia' }], error: null }
      return { data: null, error: null }
    })
    const m = await loadMemoryContext('chat1', 'what was the plan for spain?')
    expect(m.summaries).toEqual(['Costa Brava trip planning', 'recent A', 'recent B'])
    expect(m.facts).toEqual(['Flying to Barcelona Oct 3', 'Sister is Pia'])
  })

  it('never lets a slow embed hold the reply', async () => {
    const slow = new Promise<number>((r) => setTimeout(() => r(1), 200))
    expect(await withTimeout(slow, 10)).toBeNull()
  })

  it('backfills missing vectors and stops when embeddings are down', async () => {
    rpcMock.mockImplementation(async (name: string) => {
      if (name === 'chat_rows_needing_embedding')
        return { data: [{ kind: 'fact', id: 'a', content: 'x' }, { kind: 'summary', id: 'b', content: 'y' }, { kind: 'fact', id: 'c', content: 'z' }], error: null }
      return { data: null, error: null }
    })
    embedMock.mockResolvedValueOnce([1]).mockResolvedValueOnce([2]).mockResolvedValueOnce(null)
    expect(await backfillEmbeddings('chat1')).toBe(2)
    const sets = rpcMock.mock.calls.filter((c) => c[0] === 'set_chat_embedding')
    expect(sets.map((c) => c[1].p_kind)).toEqual(['fact', 'summary'])
  })
})
