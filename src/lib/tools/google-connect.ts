import type { Tool, ToolResult, UserContext } from '@/lib/llm/types'
import { createConnectLink } from '@/spectrum/store'

/**
 * Connect or reconnect Google (Gmail + Calendar) in any phrasing. The link is
 * one-use and goes out as its own bubble after the reply (rich preview), so the
 * model never has to paste it. Works whether Google is not connected, connected
 * as the wrong account, or connected but stale: the connect page shows Google's
 * account chooser and replaces the stored tokens on success. No disconnect first.
 */
const LOOSE_TTL_MS = 2 * 60 * 1000
const pending = new Map<string, { link: string; at: number }>()

export function takeLooseConnectLink(chatGuid: string): string | null {
  const e = pending.get(chatGuid)
  pending.delete(chatGuid)
  return e && Date.now() - e.at <= LOOSE_TTL_MS ? e.link : null
}

export const googleConnect: Tool = {
  name: 'google_connect',
  description:
    'Send the user a one-tap link to connect or reconnect their Google account (Gmail and Calendar). Call this the moment they ask to connect, reconnect, fix, switch or re-authorize Google or Gmail, in any wording, including "still not seeing the link". It works for a first connect, a stale or broken connection, and a different account. The link is sent to the chat for you right after your reply, so do not paste the URL and never ask them to retype a phrase or disconnect first.',
  inputSchema: { type: 'object', properties: {} },
  async execute(_input: unknown, ctx: UserContext): Promise<ToolResult> {
    if (!ctx.chatGuid) return { success: false, error: 'the connect link only works in the user\'s own chat' }
    try {
      const link = await createConnectLink(ctx.chatGuid, 'connect my gmail')
      pending.set(ctx.chatGuid, { link, at: Date.now() })
      return {
        success: true,
        data: {
          status: 'link_sent_after_your_reply',
          instruction: 'The one-tap Google link arrives as its own message right after your reply. Say so in one short line (they tap it and approve on Google; a stale or old connection is replaced, nothing to disconnect). Do not include the URL.',
        },
      }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  },
}
