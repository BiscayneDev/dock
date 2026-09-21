import { describe, it, expect, vi, beforeEach } from 'vitest'

import { isDuplicate, mergeMemorizableFacts } from './store'

vi.mock('@/lib/supabase/server', () => ({ createServerClient: vi.fn() }))
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}))
vi.mock('openai', () => ({
  default: class {
    embeddings = {
      create: vi.fn().mockResolvedValue({ data: [{ embedding: [0.1, 0.2] }] }),
    }
  },
}))

describe('isDuplicate', () => {
  it('returns true when similarity is above 0.92', () => {
    expect(isDuplicate(0.93)).toBe(true)
    expect(isDuplicate(0.99)).toBe(true)
  })

  it('returns false at or below 0.92', () => {
    expect(isDuplicate(0.92)).toBe(false)
    expect(isDuplicate(0.5)).toBe(false)
  })
})

describe('mergeMemorizableFacts', () => {
  it('filters facts matching existing contents case-insensitively', () => {
    const existing = ['  Likes COFFEE ', 'works at Acme']
    const result = mergeMemorizableFacts(
      [
        { content: 'likes coffee', type: 'preference' },
        { content: 'Works at acme', type: 'org' },
        { content: 'Has a dog named Rex', type: 'fact' },
      ],
      existing,
    )
    expect(result).toEqual([{ content: 'Has a dog named Rex', type: 'fact' }])
  })

  it('dedupes among the new facts themselves case-insensitively', () => {
    const result = mergeMemorizableFacts(
      [
        { content: 'Loves pizza', type: 'preference' },
        { content: 'loves pizza', type: 'preference' },
      ],
      [],
    )
    expect(result).toEqual([{ content: 'Loves pizza', type: 'preference' }])
  })

  it('keeps everything when nothing matches', () => {
    const facts = [
      { content: 'a', type: 'fact' },
      { content: 'b', type: 'fact' },
    ]
    expect(mergeMemorizableFacts(facts, [])).toEqual(facts)
  })
})
