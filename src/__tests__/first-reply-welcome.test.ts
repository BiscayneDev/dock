import { describe, expect, it } from 'vitest'
import { firstReplyBundleDecision } from '@/lib/spectrum/connect-lines'
import { buildSystemPrompt } from '@/lib/spectrum/dinghy'

const base = { answerDelivered: true, reply: 'What task can I help you with today?', hasProposal: false, role: 'member' as string | null }

describe('welcome bundle on the first delivered answer', () => {
  it('sends for any delivered member answer, even a short question', () => {
    expect(firstReplyBundleDecision(base)).toEqual({ send: true })
  })
  it('holds only for non-members, undelivered, empty, drafts, or short error replies', () => {
    expect(firstReplyBundleDecision({ ...base, role: 'owner' })).toEqual({ send: false, reason: 'role' })
    expect(firstReplyBundleDecision({ ...base, role: null })).toEqual({ send: false, reason: 'role' })
    expect(firstReplyBundleDecision({ ...base, answerDelivered: false })).toEqual({ send: false, reason: 'answer_not_delivered' })
    expect(firstReplyBundleDecision({ ...base, reply: '  ' })).toEqual({ send: false, reason: 'empty_reply' })
    expect(firstReplyBundleDecision({ ...base, hasProposal: true })).toEqual({ send: false, reason: 'draft_pending' })
    expect(firstReplyBundleDecision({ ...base, reply: "Couldn't read that. Try again." })).toEqual({ send: false, reason: 'error_reply' })
  })
  it('a long answer that merely starts with "Sorry" still gets the bundle', () => {
    expect(firstReplyBundleDecision({ ...base, reply: 'Sorry for the wait. ' + 'x'.repeat(200) })).toEqual({ send: true })
  })
})

describe('first-reply grounding', () => {
  it('greeting-only openers get who-I-am plus one concrete ask', () => {
    const p = buildSystemPrompt([], true, { google: false, wallet: false })
    expect(p).toContain('only a greeting')
    expect(p).toContain('Never reply with only')
  })
  it('without Google, never claims email, calendar or real-time commands', () => {
    const p = buildSystemPrompt([], false, { google: false, wallet: false })
    expect(p).toContain('never say you can see, summarize or manage their email')
    expect(p).toContain('real-time')
    expect(p).toContain('connecting Google')
  })
  it('with Google connected the no-Google restriction is absent', () => {
    expect(buildSystemPrompt([], false, { google: true, wallet: false })).not.toContain('never say you can see, summarize or manage')
  })
})
