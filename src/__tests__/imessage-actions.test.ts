import { describe, it, expect, vi, beforeEach } from 'vitest'

const rpcMock = vi.fn()
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({ rpc: rpcMock }),
}))

const sendExec = vi.fn()
const replyExec = vi.fn()
const createExec = vi.fn()
vi.mock('@/lib/tools/gmail', () => ({
  gmailSend: { name: 'gmail_send', inputSchema: { type: 'object', properties: {} }, execute: (...a: unknown[]) => sendExec(...a) },
  gmailReply: { name: 'gmail_reply', inputSchema: { type: 'object', properties: {} }, execute: (...a: unknown[]) => replyExec(...a) },
}))
vi.mock('@/lib/tools/gcal', () => ({
  gcalCreateEvent: { name: 'gcal_create_event', inputSchema: { type: 'object', properties: {} }, execute: (...a: unknown[]) => createExec(...a) },
  gcalUpdateEvent: { name: 'gcal_update_event' },
  gcalGetEvent: { name: 'gcal_get_event' },
  gcalFindFreeTime: { name: 'gcal_find_free_time' },
}))

import { actionToolsFor, executePendingAction, parseConfirmation, renderProposal } from '@/lib/spectrum/actions'
import type { UserContext } from '@/lib/llm/types'

const ctx = { userId: 'u1', tokens: { google: { access_token: 'x' } } } as unknown as UserContext
const tool = (name: string) => actionToolsFor('chat-1').tools.find((t) => t.name === name)!

beforeEach(() => {
  rpcMock.mockReset()
  sendExec.mockReset()
  replyExec.mockReset()
  createExec.mockReset()
})

describe('parseConfirmation', () => {
  it('reads clear yes / no only', () => {
    for (const y of ['y', 'Yes', 'yep!', 'send it', 'go ahead', '👍']) expect(parseConfirmation(y)).toBe('yes')
    for (const n of ['n', 'no', 'Cancel', 'nvm', "don't"]) expect(parseConfirmation(n)).toBe('no')
    for (const x of ['yes but change the subject', 'what time is it', 'ok so', '']) expect(parseConfirmation(x)).toBeNull()
  })
})

describe('renderProposal', () => {
  it('shows the exact email draft', () => {
    const t = renderProposal({ id: '1', kind: 'gmail_send', payload: { to: 'a@b.co', subject: 'Hi', body: 'Body here' } })
    expect(t).toContain('to: a@b.co')
    expect(t).toContain('subject: Hi')
    expect(t).toContain('Body here')
    expect(t).toMatch(/reply y to send/)
  })
})

describe('action tools', () => {
  it('email_send only stores a draft, never sends', async () => {
    rpcMock.mockResolvedValue({ data: 'pa-1', error: null })
    const set = actionToolsFor('chat-1')
    const t = set.tools.find((x) => x.name === 'email_send')!
    const r = await t.execute({ to: 'a@b.co', subject: 's', body: 'b' }, ctx)
    expect(sendExec).not.toHaveBeenCalled()
    expect(rpcMock).toHaveBeenCalledWith('create_pending_action', expect.objectContaining({ p_chat_guid: 'chat-1', p_kind: 'gmail_send' }))
    expect((r.data as { status: string }).status).toBe('awaiting_user_confirmation')
    expect(set.proposal()?.id).toBe('pa-1')
  })

  it('calendar event without attendees runs directly', async () => {
    createExec.mockResolvedValue({ success: true, data: { id: 'e1' } })
    await tool('gcal_create_event').execute({ summary: 'gym', start: 's', end: 'e', attendees: [] }, ctx)
    expect(createExec).toHaveBeenCalledWith({ summary: 'gym', start: 's', end: 'e' }, ctx)
    expect(rpcMock).not.toHaveBeenCalled()
  })

  it('calendar event with attendees becomes a draft', async () => {
    rpcMock.mockResolvedValue({ data: 'pa-2', error: null })
    await tool('gcal_create_event').execute({ summary: 'lunch', start: 's', end: 'e', attendees: ['x@y.co'] }, ctx)
    expect(createExec).not.toHaveBeenCalled()
    expect(rpcMock).toHaveBeenCalledWith('create_pending_action', expect.objectContaining({ p_kind: 'gcal_create_invite' }))
  })
})

describe('executePendingAction', () => {
  it('runs the claimed draft once for the proposing user', async () => {
    rpcMock.mockImplementation((fn: string) =>
      fn === 'claim_pending_action'
        ? Promise.resolve({ data: [{ id: 'pa-1', user_id: 'u1', kind: 'gmail_send', payload: { to: 'a@b.co', subject: 's', body: 'b' } }], error: null })
        : Promise.resolve({ data: null, error: null }),
    )
    sendExec.mockResolvedValue({ success: true, data: { id: 'm1' } })
    expect(await executePendingAction('chat-1', ctx)).toBe('sent to a@b.co.')
    expect(sendExec).toHaveBeenCalledTimes(1)
    expect(rpcMock).toHaveBeenCalledWith('finish_pending_action', expect.objectContaining({ p_id: 'pa-1', p_status: 'done' }))
  })

  it('sends invites for a confirmed invite draft', async () => {
    rpcMock.mockImplementation((fn: string) =>
      fn === 'claim_pending_action'
        ? Promise.resolve({ data: [{ id: 'pa-2', user_id: 'u1', kind: 'gcal_create_invite', payload: { summary: 'l', start: 's', end: 'e', attendees: ['x@y.co'] } }], error: null })
        : Promise.resolve({ data: null, error: null }),
    )
    createExec.mockResolvedValue({ success: true, data: {} })
    await executePendingAction('chat-1', ctx)
    expect(createExec).toHaveBeenCalledWith(expect.objectContaining({ sendUpdates: 'all', attendees: ['x@y.co'] }), ctx)
  })

  it('refuses when the chat is bound to a different user', async () => {
    rpcMock.mockImplementation((fn: string) =>
      fn === 'claim_pending_action'
        ? Promise.resolve({ data: [{ id: 'pa-1', user_id: 'someone-else', kind: 'gmail_send', payload: {} }], error: null })
        : Promise.resolve({ data: null, error: null }),
    )
    const out = await executePendingAction('chat-1', ctx)
    expect(sendExec).not.toHaveBeenCalled()
    expect(out).toMatch(/couldn't send/)
  })

  it('says expired when nothing is open', async () => {
    rpcMock.mockResolvedValue({ data: [], error: null })
    expect(await executePendingAction('chat-1', ctx)).toMatch(/expired/)
  })
})
