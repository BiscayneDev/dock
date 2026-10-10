import { describe, expect, it } from 'vitest'
import { gateTools } from '@/lib/spectrum/tool-gating'
import type { Tool } from '@/lib/llm/types'

const mk = (name: string): Tool => ({ name, description: name, inputSchema: { type: 'object', properties: {} }, async execute() { return { success: true, data: {} } } })
const names = ['web_search', 'weather', 'create_file', 'reminder_set', 'spend_summary', 'google_connect', 'gmail_search', 'gmail_read', 'email_send', 'gcal_list_events', 'gcal_create_event', 'wallet_balances', 'paybox_onramp', 'x_profile', 'twitter_search', 'github_list_repos', 'computer_run', 'browser_connect', 'workflow_save', 'invite_link', 'revoke_file', 'some_future_tool']
const all = names.map(mk)
const offered = (g: { active: Tool[] }) => g.active.map((t) => t.name)

describe('gateTools', () => {
  it('a plain lookup gets core tools only, plus more_tools', () => {
    const g = gateTools(all, ['find chicken rice near Parkroyal Pickering'])
    const o = offered(g)
    expect(o).toEqual(expect.arrayContaining(['web_search', 'weather', 'create_file', 'reminder_set', 'spend_summary', 'google_connect', 'some_future_tool', 'more_tools']))
    for (const n of ['gmail_search', 'email_send', 'wallet_balances', 'x_profile', 'github_list_repos', 'computer_run', 'invite_link']) expect(o).not.toContain(n)
    expect(g.withheld.length).toBeGreaterThan(3)
  })
  it('keyword groups turn on from the message', () => {
    expect(offered(gateTools(all, ['reply to the email from Sam']))).toEqual(expect.arrayContaining(['gmail_search', 'email_send']))
    expect(offered(gateTools(all, ["what's on my calendar tomorrow"]))).toContain('gcal_list_events')
    expect(offered(gateTools(all, ['check my wallet balance']))).toContain('wallet_balances')
    expect(offered(gateTools(all, ['open https://example.com and fill the form']))).toContain('computer_run')
  })
  it('recent context keeps the thread tools for a bare follow-up', () => {
    expect(offered(gateTools(all, ['yes send it', 'draft the email to Sam', 'Here is a draft email reply:']))).toContain('email_send')
  })
  it('never withholds unknown tools, and small sets pass through', () => {
    expect(offered(gateTools(all, ['hi']))).toContain('some_future_tool')
    const small = names.slice(0, 5).map(mk)
    expect(gateTools(small, ['hi'])).toMatchObject({ withheld: [] })
    expect(offered(gateTools(small, ['hi']))).toHaveLength(5)
  })
  it('more_tools enables a withheld group in place', async () => {
    const g = gateTools(all, ['hi'])
    expect(offered(g)).not.toContain('gmail_search')
    const more = g.active.find((t) => t.name === 'more_tools')!
    const r = await more.execute({ groups: ['email', 'nonsense'] }, {} as never)
    expect(r).toMatchObject({ success: true, data: { enabled: ['email'] } })
    expect(offered(g)).toEqual(expect.arrayContaining(['gmail_search', 'email_send']))
  })
  it('offers fewer tools on a plain turn', () => {
    expect(gateTools(all, ['hi']).active.length).toBeLessThan(all.length - 8)
  })
})
