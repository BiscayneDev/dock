import { afterEach, describe, expect, it, vi } from 'vitest'
import { chatWithTools } from '@/lib/spectrum/dinghy'
import { googleSafeBody, isGoogleTool, PrivateRouteUnavailable, privateRouteEnforced } from '@/lib/spectrum/routing'
import { googleEmbeddingAllowed, embedText } from '@/lib/memory/embeddings'
import { googleTtlDays } from '@/lib/spectrum/google-retention'
import type { Tool } from '@/lib/llm/types'

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })

const resp = (message: Record<string, unknown>, finish: string) =>
  ({ ok: true, headers: new Headers(), json: async () => ({ choices: [{ finish_reason: finish, message }] }) }) as unknown as Response
const call = (name: string) => ({ id: `c_${name}`, type: 'function', function: { name, arguments: '{}' } })
const tool = (name: string, spy = vi.fn()): Tool => ({ name, description: name, inputSchema: { type: 'object', properties: {} }, execute: async () => { spy(); return { success: true, data: { ok: true } } } })
const ctx = { tokens: {} } as never
const opts = { gatewayUrl: 'http://gw', apiKey: 'k', model: 'pinned', routing: { providers: ['hopscotch'] } }

describe('private route', () => {
  it('classifies tools', () => {
    expect(isGoogleTool('gmail_search') && isGoogleTool('gcal_list_events') && isGoogleTool('workflow_run')).toBe(true)
    expect(isGoogleTool('weather')).toBe(false)
  })

  it('off by default: provider restriction only, same as before', () => {
    expect(privateRouteEnforced()).toBe(false)
    expect(googleSafeBody()).toEqual({ shipyard: { providers: ['hopscotch'] } })
  })

  it('enforced: private allowlist, model auto, fail closed when empty', () => {
    vi.stubEnv('DINGHY_PRIVATE_ROUTE', 'on')
    expect(() => googleSafeBody()).toThrow(PrivateRouteUnavailable)
    vi.stubEnv('DINGHY_PRIVATE_PROVIDERS', 'venice-private, venice-tee')
    expect(googleSafeBody()).toEqual({ model: 'auto', shipyard: { providers: ['venice-private', 'venice-tee'] } })
  })

  it('Google-derived text is never embedded without a confirmed private endpoint', async () => {
    expect(googleEmbeddingAllowed({})).toBe(false)
    expect(googleEmbeddingAllowed({ EMBEDDINGS_BASE_URL: 'http://x' })).toBe(false)
    expect(googleEmbeddingAllowed({ EMBEDDINGS_BASE_URL: 'http://x', EMBEDDINGS_GOOGLE_OK: '1' })).toBe(true)
    expect(await embedText('secret from gmail', { googleDerived: true })).toBeNull()
  })

  it('retention days default to 30 and reject junk', () => {
    expect(googleTtlDays({})).toBe(30)
    expect(googleTtlDays({ GOOGLE_DERIVED_TTL_DAYS: '14' })).toBe(14)
    expect(googleTtlDays({ GOOGLE_DERIVED_TTL_DAYS: '0' })).toBe(30)
    expect(googleTtlDays({ GOOGLE_DERIVED_TTL_DAYS: 'abc' })).toBe(30)
  })
})
