import { describe, it, expect, vi, beforeEach } from 'vitest'

// Workstream D3: extraction + injection parity across a user's chats, and
// guest-chat isolation. The Supabase client is mocked, so these tests pin
// the CALL PATTERN (which user-keyed vs chat-keyed RPC each path uses with
// which arguments). The SQL semantics of the 035 RPCs themselves are
// reviewed against migration-024 rigor (see 035_user_memory.sql) — flagged
// for live-Postgres verification in the PR.

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
vi.mock('@/lib/spectrum/config', () => ({
  GATEWAY_URL: 'http://gateway.test',
  SHIPYARD_API_KEY: 'test-key',
  SHIPYARD_MODEL: 'test-model',
}))

// spectrum_identities lookup — boundChats: chat_guid -> user_id.
// spectrum_messages returns a fixed message set (messagesQueryRows).
let boundChats: Record<string, string> = {}
let messagesQueryRows: unknown[] = []

function makeQuery(table: string) {
  const state = { chatGuid: '' as string }
  const q: Record<string, unknown> = {
    select: () => q,
    eq: (k: string, v: string) => {
      if (k === 'chat_guid') state.chatGuid = v
      return q
    },
    not: () => q,
    order: () => q,
    limit: async () => {
      if (table === 'spectrum_identities') {
        const user = boundChats[state.chatGuid]
        return { data: user ? [{ user_id: user }] : [], error: null }
      }
      return { data: messagesQueryRows, error: null }
    },
  }
  return q
}

import { loadMemoryContext, updateMemory, renderMemoryBlock } from '@/lib/spectrum/memory'

beforeEach(() => {
  rpcMock.mockReset()
  fromMock.mockReset()
  fromMock.mockImplementation((table: string) => makeQuery(table))
  boundChats = {}
  messagesQueryRows = []
})

const USER = 'u-halsey'
const CHAT_A = 'imsg+chat-a'
const CHAT_B = 'imsg+chat-b'

const gatewayResponse = (content: string) =>
  new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 })

describe('D3 parity: two chats, same user', () => {
  it('stores a fact extracted in chat A under the USER (user_id, channel tagged)', async () => {
    boundChats[CHAT_A] = USER
    messagesQueryRows = Array.from({ length: 12 }, (_, i) => ({
      role: 'user',
      content: `msg ${i}`,
      created_at: new Date(Date.now() + i * 1000).toISOString(),
    }))
    rpcMock.mockImplementation(async (fn: string) => {
      if (fn === 'claim_user_memory_update') return { data: [{ total: 10, previously_seen: 0, last_summary_at: null }], error: null }
      if (fn === 'dinghy_user_memory_context') return { data: { profile: '', summaries: [] }, error: null }
      if (fn === 'recent_user_memories') return { data: [], error: null }
      return { data: null, error: null }
    })
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      gatewayResponse('{"profile":"- name: Halsey","facts":[{"content":"Sister is Pia","type":"person"}]}'),
    )
    embedMock.mockResolvedValue(null)
    await updateMemory(CHAT_A, 'imessage')

    const add = rpcMock.mock.calls.find((c) => c[0] === 'add_user_memory')
    expect(add).toBeTruthy()
    expect(add![1]).toMatchObject({ p_user_id: USER, p_chat_guid: CHAT_A, p_channel: 'imessage', p_content: 'Sister is Pia' })
    // per-chat claim cadence is preserved: user-level RPC, still p_every gated
    const claim = rpcMock.mock.calls.find((c) => c[0] === 'claim_user_memory_update')
    expect(claim![1]).toEqual({ p_user_id: USER, p_chat_guid: CHAT_A, p_every: 10 })
    // profile is written to the user-level store, not the per-chat one
    expect(rpcMock.mock.calls.some((c) => c[0] === 'save_dinghy_user_profile')).toBe(true)
    expect(rpcMock.mock.calls.some((c) => c[0] === 'save_dinghy_profile')).toBe(false)
  })

  it('a fact written in chat A is INJECTED in chat B of the same user', async () => {
    boundChats[CHAT_B] = USER
    rpcMock.mockImplementation(async (fn: string) => {
      // user-scoped read: the RPC aggregates across the user's chats
      if (fn === 'dinghy_user_memory_context') return { data: { profile: '- name: Halsey', summaries: [] }, error: null }
      if (fn === 'match_user_memories') return { data: [{ content: 'Sister is Pia', similarity: 0.8 }], error: null }
      if (fn === 'recent_user_memories') return { data: [{ content: 'Sister is Pia' }], error: null }
      return { data: null, error: null }
    })
    const m = await loadMemoryContext(CHAT_B, 'who is pia?')
    // user-level RPCs were used (never the chat_guid ones)
    expect(rpcMock.mock.calls.some((c) => c[0] === 'dinghy_memory_context')).toBe(false)
    expect(rpcMock.mock.calls.some((c) => c[0] === 'match_chat_memories')).toBe(false)
    expect(rpcMock.mock.calls.some((c) => c[0] === 'recent_chat_memories')).toBe(false)
    const ctxCall = rpcMock.mock.calls.find((c) => c[0] === 'dinghy_user_memory_context')!
    expect(ctxCall[1]).toEqual({ p_user_id: USER })
    // and the fact renders into the prompt block
    const block = renderMemoryBlock(m)
    expect(block).toContain('Sister is Pia')
    expect(block).toContain('- name: Halsey')
  })
})

describe('D3 isolation: guest / unbound chats stay chat_guid-keyed', () => {
  it('reads and writes use only chat_guid RPCs for a guest chat', async () => {
    messagesQueryRows = Array.from({ length: 12 }, (_, i) => ({
      role: 'user',
      content: `msg ${i}`,
      created_at: new Date(Date.now() + i * 1000).toISOString(),
    }))
    rpcMock.mockImplementation(async (fn: string) => {
      if (fn === 'dinghy_memory_context') return { data: { profile: '', summaries: [] }, error: null }
      if (fn === 'recent_chat_memories') return { data: [], error: null }
      return { data: null, error: null }
    })
    const m = await loadMemoryContext('guest-chat', 'hello there')
    expect(rpcMock.mock.calls.some((c) => c[0] === 'dinghy_user_memory_context')).toBe(false)
    expect(rpcMock.mock.calls.some((c) => c[0] === 'match_user_memories')).toBe(false)
    expect(rpcMock.mock.calls.some((c) => c[0] === 'recent_user_memories')).toBe(false)
    const ctxCall = rpcMock.mock.calls.find((c) => c[0] === 'dinghy_memory_context')!
    expect(ctxCall[1]).toEqual({ p_chat_guid: 'guest-chat' })
    expect(m).toEqual({ profile: '', summaries: [], facts: [] })

    // writes: claim at chat level, facts stored without a user_id
    rpcMock.mockImplementation(async (fn: string) => {
      if (fn === 'claim_memory_update') return { data: [{ total: 10, previously_seen: 0, last_summary_at: null }], error: null }
      if (fn === 'dinghy_memory_context') return { data: { profile: '', summaries: [] }, error: null }
      if (fn === 'recent_chat_memories') return { data: [], error: null }
      return { data: null, error: null }
    })
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      gatewayResponse('{"profile":"- guest","facts":[{"content":"Prefers tacos","type":"preference"}]}'),
    )
    embedMock.mockResolvedValue(null)
    await updateMemory('guest-chat', 'imessage')
    expect(rpcMock.mock.calls.some((c) => c[0] === 'claim_user_memory_update')).toBe(false)
    expect(rpcMock.mock.calls.some((c) => c[0] === 'add_user_memory')).toBe(false)
    const add = rpcMock.mock.calls.find((c) => c[0] === 'add_chat_memory')
    expect(add![1]).toMatchObject({ p_chat_guid: 'guest-chat', p_channel: 'imessage', p_content: 'Prefers tacos' })
    expect(add![1].p_user_id).toBeUndefined()
  })

  it('a bound chat never leaks its user scope into a different user chat', async () => {
    boundChats[CHAT_A] = USER
    const OTHER = 'u-someone-else'
    boundChats['imsg+chat-c'] = OTHER
    rpcMock.mockImplementation(async (fn: string) => {
      if (fn === 'dinghy_user_memory_context') return { data: { profile: '', summaries: [] }, error: null }
      if (fn === 'match_user_memories') return { data: [], error: null }
      if (fn === 'recent_user_memories') return { data: [], error: null }
      return { data: null, error: null }
    })
    await loadMemoryContext('imsg+chat-c', 'anything')
    // chat C reads with ITS user's id, never chat A's
    const ctxCall = rpcMock.mock.calls.find((c) => c[0] === 'dinghy_user_memory_context')!
    expect(ctxCall[1]).toEqual({ p_user_id: OTHER })
  })
})
