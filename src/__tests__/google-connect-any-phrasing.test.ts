import { describe, expect, it, vi } from 'vitest'
import { isGoogleReconnectIntent } from '@/lib/spectrum/connect-lines'
import { buildSystemPrompt } from '@/lib/spectrum/dinghy'

vi.mock('@/spectrum/store', () => ({ createConnectLink: vi.fn(async (chat: string) => `https://app.test/connect?connect=${chat}`) }))

describe('reconnect intent (Google already looks connected)', () => {
  it.each([
    'Connect my Gmail',
    'Still not seeing the link in chat. Please connect my Gmail',
    'reconnect my google',
    "it says disconnected, can you fix my gmail",
    'send me the google link again',
    'where is the link to connect my calendar',
    'relink my gmail please',
  ])('matches %s', (t) => expect(isGoogleReconnectIntent(t)).toBe(true))
  it.each([
    'summarize my inbox',
    'what is on my calendar tomorrow',
    'any email from Sam about the link he sent',
    'hi',
    'connect my github',
  ])('does not match %s', (t) => expect(isGoogleReconnectIntent(t)).toBe(false))
})

describe('google_connect tool', () => {
  it('queues the link for the handler and tells the model not to paste it or disconnect', async () => {
    const { googleConnect, takeLooseConnectLink } = await import('@/lib/tools/google-connect')
    const r = await googleConnect.execute({}, { userId: 'u', chatGuid: 'chat-1' } as never)
    expect(r.success).toBe(true)
    expect(JSON.stringify(r.data)).toContain('Do not include the URL')
    expect(takeLooseConnectLink('chat-1')).toBe('https://app.test/connect?connect=chat-1')
    expect(takeLooseConnectLink('chat-1')).toBeNull()
  })
  it('refuses outside a chat', async () => {
    const { googleConnect } = await import('@/lib/tools/google-connect')
    expect((await googleConnect.execute({}, { userId: 'u' } as never)).success).toBe(false)
  })
  it('is offered to every bound user', async () => {
    const { toolsFor } = await import('@/lib/spectrum/imessage-tools')
    expect(toolsFor({ userId: 'u', tokens: {} } as never).map((t) => t.name)).toContain('google_connect')
  })
})

describe('prompt', () => {
  it('says call google_connect, never ask to retype or disconnect first', () => {
    const p = buildSystemPrompt([], false, { google: true, wallet: false })
    expect(p).toContain('call google_connect right away')
    expect(p).toContain('never ask whether to disconnect first')
    expect(p).toContain('never ask them to retype')
  })
})
