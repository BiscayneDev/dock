import { describe, expect, it } from 'vitest'
import { buildSystemPrompt } from '@/lib/spectrum/dinghy'
import { denyMessage } from '@/lib/browser-sessions/policy'

describe('capability voice', () => {
  const full = buildSystemPrompt([], false, { google: true, wallet: false, computer: true, reminders: true })

  it('bans "I can\'t" phrasing instead of allowing it as a last resort', () => {
    expect(full).toContain('Never write "I can\'t"')
    expect(full).not.toContain('last resort')
  })

  it('routes Google to the connect link, not browser_connect', () => {
    expect(full).toContain('connect my gmail')
    expect(full).toContain('never goes through browser_connect')
  })

  it('proposes connect for a named kind of account by asking which site', () => {
    expect(full).toContain('ask which site')
  })

  it('has recurring and email-archive guidance', () => {
    expect(full).toContain('Recurring asks')
    expect(full).toContain('exactly one scoping question')
  })

  it('omits the connect line without browser tools', () => {
    const p = buildSystemPrompt([], false, { google: true, wallet: false })
    expect(p).not.toContain('call browser_connect')
  })

  it('denial for Google points at the Google connect link', () => {
    const m = denyMessage('google.com', 'identity')
    expect(m).toContain('connect my gmail')
    expect(m).not.toMatch(/I can't/)
  })

  it('denial for other sites avoids "can\'t" and offers alternatives', () => {
    const m = denyMessage('chase.com', 'financial')
    expect(m).toContain('what does work')
    expect(m).not.toContain("so I can't")
  })
})

describe('capability scoping lines', () => {
  const p = buildSystemPrompt([], false, { google: true, wallet: false, computer: true, reminders: true })
  it('checks browser_sessions before claiming nothing is saved', () => {
    expect(p).toContain('call browser_sessions')
  })
  it('covers cross-user, allowance, taxes and workplace chat', () => {
    expect(p).toContain("another person's login")
    expect(p).toContain('used up')
    expect(p).toContain('taxes')
    expect(p).toContain('their own account')
  })
})

describe('dry-run routed model', () => {
  it('surfaces per-call routing from onUsage', async () => {
    const { runDryRun } = await import('@/lib/dry-run/run')
    const r = await runDryRun({ msg: 'hi' } as never, {
      realTools: [],
      chatWithTools: (async (_h: unknown, opts: { onUsage?: (u: unknown) => void }) => {
        opts.onUsage?.({ model: 'routed-x', inputTokens: 3, outputTokens: 2, costUsd: 0.001, latencyMs: 5 })
        return { reply: 'ok', toolCalls: 0, iterations: 1 }
      }) as never,
    })
    expect(r.routed_models).toEqual([{ model: 'routed-x', input_tokens: 3, output_tokens: 2, cost_usd: 0.001, latency_ms: 5 }])
  })
})

describe('dry-run routing', () => {
  it('passes routing prefs so the router, not a pin, picks the model', async () => {
    const { runDryRun } = await import('@/lib/dry-run/run')
    let seen: { routing?: unknown } = {}
    await runDryRun({ msg: 'hi' } as never, {
      realTools: [],
      chatWithTools: (async (_h: unknown, opts: { routing?: unknown }) => {
        seen = opts
        return { reply: 'ok', toolCalls: 0, iterations: 1 }
      }) as never,
    })
    expect(seen.routing).toEqual({ providers: ['hopscotch'] })
  })
})
