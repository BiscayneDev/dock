import { describe, it, expect } from 'vitest'

// Sandbox check for x402 recipe execution (Workstream E2): the tool list
// exposed to an x402 execution must contain no write, send, delete, or
// spend-capable tools. Untrusted payer input runs against the recipe
// creator's context, so this list is the security boundary.
//
// Imported from ./x402-sandbox directly — importing the '@/lib/tools' barrel
// would pull @solana/web3.js, which can't load under vitest.
import { x402RecipeTools } from '@/lib/tools/x402-sandbox'

const toolNames = x402RecipeTools.map((t) => t.name)

// Any tool name that moves money or mutates user state must never appear.
const FORBIDDEN_PATTERNS: Array<[RegExp, string]> = [
  [/send|payment|swap|sign|secret|credential|portfolio|spend/i, 'money movement / spend surface'],
  [/^x402_fetch$/i, 'paid x402 call'],
  [/forget|delete|create|draft|send|archive|label|cancel|set_|update|switch/i, 'write / destructive action'],
  [/^recipe/i, 'recipe management'],
]

describe('x402RecipeTools sandbox', () => {
  it('contains no write, send, delete, or spend tools', () => {
    expect(toolNames.length).toBeGreaterThan(0)
    for (const name of toolNames) {
      for (const [pattern, why] of FORBIDDEN_PATTERNS) {
        expect(name, `${name} looks like a ${why}`).not.toMatch(pattern)
      }
    }
  })

  it('only exposes the documented read-only allowlist', () => {
    const ALLOWED = new Set([
      'web_search',
      'web_fetch',
      'github_list_repos',
      'github_get_repo',
      'github_list_issues',
      'github_get_issue',
      'github_list_prs',
      'github_get_pr',
      'token_price',
      'trending_tokens',
    ])
    for (const name of toolNames) {
      expect(ALLOWED.has(name), `unexpected tool in x402 sandbox: ${name}`).toBe(true)
    }
  })

  it('never exposes wallet, paybox, or gmail tools', () => {
    for (const name of toolNames) {
      expect(name.startsWith('wallet_')).toBe(false)
      expect(name.startsWith('paybox_')).toBe(false)
      expect(name.startsWith('gmail_')).toBe(false)
      expect(name.startsWith('gcal_')).toBe(false)
      expect(name.startsWith('memory_')).toBe(false)
    }
  })
})
