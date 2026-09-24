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
