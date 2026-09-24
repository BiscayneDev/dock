import { describe, it, expect } from 'vitest'
import { buildSystemPrompt, productFactsFor } from '@/lib/spectrum/dinghy'

const facts = [
  { key: 'owner', value: 'Halsey' },
  { key: 'product', value: 'Dinghy' },
]

describe('onboarding prompt', () => {
  it('beta members never see owner facts; the owner does', () => {
    expect(productFactsFor('member', facts).map((f) => f.key)).toEqual(['product'])
    expect(productFactsFor(null, facts).map((f) => f.key)).toEqual(['product'])
    expect(productFactsFor('owner', facts)).toHaveLength(2)
  })

  it('labels product facts as product context, not facts about the person', () => {
    const p = buildSystemPrompt(productFactsFor('member', facts), false)
    expect(p).toContain('About Dinghy (product context, not facts about the person')
    expect(p).not.toContain('Halsey')
    expect(p).not.toContain('Known facts')
  })

  it('first message gets the welcome + opener, even with product facts present', () => {
    const p = buildSystemPrompt(productFactsFor('member', facts), true)
    expect(p).toContain("What's taking up most of your time this week?")
    expect(p).toContain('contact card just arrived')
  })
})

describe('grounding rules', () => {
  it('grounding means do the work, then answer - never hedge or hand the question back', async () => {
    const { GROUNDING_LINE } = await import('@/lib/spectrum/dinghy')
    expect(GROUNDING_LINE).toContain('A question is a work order')
    expect(GROUNDING_LINE).toContain('published_date')
    expect(GROUNDING_LINE).toContain('never hand the question back')
    expect(GROUNDING_LINE).toContain('only after the searches were actually run')
  })
  it('the prompt ends with the style anchor so old lowercase history does not set the tone', async () => {
    const { STYLE_ANCHOR, buildSystemPrompt } = await import('@/lib/spectrum/dinghy')
    expect(STYLE_ANCHOR).toContain('sentence case')
    expect(buildSystemPrompt([], false)).toContain('does work for people')
  })
})
