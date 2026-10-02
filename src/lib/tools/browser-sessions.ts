import type { Tool, ToolResult, UserContext } from '@/lib/llm/types'
import { auditEvent, listCapabilities, revokeCapabilities } from '@/lib/capabilities/store'
import { mintLoginLink } from '@/lib/browser-sessions/login'
import { normalizeSite } from '@/lib/browser-sessions/policy'

/**
 * Logged-in site sessions, created and removed from chat. The login itself
 * happens on a Dinghy page in a private browser the user drives; passwords
 * never go in chat.
 */

export const browserConnect: Tool = {
  name: 'browser_connect',
  description:
    "Let the user connect a website so you can use their logged-in account there (read-only for now). Returns a one-use link that opens a private browser where THEY log in. Use when they ask to connect/log in/give you access to a site. Never ask them to text a password, cookie or code. Refused: banks, brokers, payroll/tax, crypto, payment apps, email and sign-in providers (Google, Apple, Microsoft, Yahoo), social, shopping and travel accounts, cloud consoles, password managers and government sites. Best for low-stakes sites (code hosts, docs, news subscriptions); for other sites the user must tick a confirm box on the page.",
  inputSchema: {
    type: 'object',
    properties: { site: { type: 'string', description: 'Site name or URL, e.g. github.com' } },
    required: ['site'],
  },
  async execute(input: unknown, ctx: UserContext): Promise<ToolResult> {
    const site = String((input as { site?: unknown } | null)?.site ?? '').trim()
    if (!site) return { success: false, error: 'site is required' }
    if (!ctx.userId) return { success: false, error: 'connecting a site is only available to bound users' }
    try {
      const r = await mintLoginLink(ctx.userId, ctx.chatGuid ?? null, site)
      if (!r.ok) return { success: false, error: r.error }
      return {
        success: true,
        data: {
          site: r.site,
          link: r.url,
          expires_minutes: r.minutes,
          instruction:
            `Send the link as-is. Tell them it opens a private browser for ${r.site} where they log in themselves (including any 2-step code), then tap "i'm logged in". ` +
            `Read-only, kept encrypted for 30 days, only used when they say yes to a task, and "disconnect ${r.site}" deletes it. One-use, expires in ${r.minutes} minutes. ` +
            'Never ask them to text a password or code.',
        },
      }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  },
}

export const browserSessions: Tool = {
  name: 'browser_sessions',
  description: "List the sites the user has connected for logged-in browsing (site, mode, when it expires). Never returns cookies.",
  inputSchema: { type: 'object', properties: {} },
  async execute(_input: unknown, ctx: UserContext): Promise<ToolResult> {
    if (!ctx.userId) return { success: false, error: 'only available to bound users' }
    const rows = await listCapabilities(ctx.userId, 'browser_session')
    return {
      success: true,
      data: { sessions: rows.map((r) => ({ site: r.label, mode: r.mode, expires_at: r.expires_at, last_used_at: r.last_used_at })) },
    }
  },
}

export const browserDisconnect: Tool = {
  name: 'browser_disconnect',
  description:
    "Delete a connected site's saved login now. Pass site to remove one, or all: true to remove every connected site. Use when the user asks to disconnect, log out, forget or revoke a site.",
  inputSchema: {
    type: 'object',
    properties: {
      site: { type: 'string', description: 'Site to disconnect, e.g. github.com' },
      all: { type: 'boolean', description: 'Remove every connected site' },
    },
  },
  async execute(input: unknown, ctx: UserContext): Promise<ToolResult> {
    if (!ctx.userId) return { success: false, error: 'only available to bound users' }
    const i = (input ?? {}) as { site?: unknown; all?: unknown }
    if (i.all === true) {
      const n = await revokeCapabilities(ctx.userId, 'browser_session')
      await auditEvent({ userId: ctx.userId, kind: 'browser_session', label: '*', event: 'disconnected', detail: { removed: n } })
      return { success: true, data: { removed: n } }
    }
    const site = normalizeSite(String(i.site ?? ''))
    if (!site) return { success: false, error: 'tell me which site, or say all' }
    const n = await revokeCapabilities(ctx.userId, 'browser_session', site)
    await auditEvent({ userId: ctx.userId, kind: 'browser_session', label: site, event: 'disconnected', detail: { removed: n } })
    return { success: true, data: { site, removed: n } }
  },
}

export const BROWSER_SESSION_TOOLS: Tool[] = [browserConnect, browserSessions, browserDisconnect]
