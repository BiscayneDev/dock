import { describe, it, expect, vi, beforeEach } from 'vitest'

const rpcMock = vi.fn()
const fromMock = vi.fn()
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({ rpc: rpcMock, from: fromMock }),
}))
vi.mock('@/lib/memory/embeddings', () => ({
  embedText: vi.fn(async () => null),
  currentEmbeddingModel: () => 'test-model',
}))

import {
  cleanFacts,
  cleanProfile,
  loadMemoryContext,
  looksSecret,
  parseJsonObject,
  renderMemoryBlock,
  updateMemory,
} from '@/lib/spectrum/memory'

beforeEach(() => {
  rpcMock.mockReset()
  fromMock.mockReset()
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

describe('updateMemory', () => {
  it('is a no-op when no update is due', async () => {
    rpcMock.mockResolvedValue({ data: [], error: null })
    await updateMemory('chat-1')
    expect(rpcMock).toHaveBeenCalledTimes(1)
    expect(rpcMock).toHaveBeenCalledWith('claim_memory_update', { p_chat_guid: 'chat-1', p_every: 10 })
    expect(fromMock).not.toHaveBeenCalled()
  })
})
