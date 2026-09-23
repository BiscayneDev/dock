/**
 * iMessage tool context: resolve a Spectrum chat guid to its bound Dock
 * user + decrypted Google tokens, and the read-only tool set offered on
 * the iMessage path.
 *
 * Per-user by construction: tools run ONLY against the identity bound to
 * the requesting chat, and binding itself is fail-closed on the beta
 * allowlist (see connect-token.ts) — one chat's tools can never reach
 * another user's accounts.
 */

import { createServerClient } from '@/lib/supabase/server'
import { decryptTokenFromDb } from '@/lib/crypto'
import type { DecryptedTokens, Tool, UserContext } from '@/lib/llm/types'
import { gmailSearch, gmailRead, gmailSummarizeInbox } from '@/lib/tools/gmail'
import { gcalListEvents, gcalTodayBriefing } from '@/lib/tools/gcal'
import { WALLET_READ_TOOLS } from '@/lib/tools/wallet-read'

/**
 * Read tools only (Halsey, 2026-09-22: email + calendar reads first;
 * writes/sends come later behind an explicit approval flow).
 */
export const IMESSAGE_READ_TOOLS: Tool[] = [
    gmailSearch,
    gmailRead,
    gmailSummarizeInbox,
    gcalListEvents,
    gcalTodayBriefing,
]

export interface ImessageCapabilities {
    google: boolean
    wallet: boolean
}

export function capabilitiesFor(ctx: UserContext): ImessageCapabilities {
    return { google: Boolean(ctx.tokens.google), wallet: Boolean(ctx.tokens.paybox) }
}

/**
 * The tool set for this user: Google read tools when Google is connected,
 * PayBox wallet reads when PayBox is connected. Read-only either way.
 */
export function toolsFor(ctx: UserContext): Tool[] {
    const caps = capabilitiesFor(ctx)
    return [...(caps.google ? IMESSAGE_READ_TOOLS : []), ...(caps.wallet ? WALLET_READ_TOOLS : [])]
}

/**
 * The UserContext for a Spectrum chat, or null when the chat is not bound
 * to a user with Google connected — the caller then stays on the plain
 * no-tools path (connect-link flow still covers the unconnected case).
 */
export async function loadImessageToolContext(chatGuid: string): Promise<UserContext | null> {
    const supabase = createServerClient()

    const { data: identity } = await supabase
        .from('spectrum_identities')
        .select('user_id')
        .eq('chat_guid', chatGuid)
        .maybeSingle()
    const userId = (identity?.user_id as string | null) ?? null
    if (!userId) return null

    const { data: user } = await supabase
        .from('users')
        .select('id, name, timezone')
        .eq('id', userId)
        .maybeSingle()

    const { data: tokenRows } = await supabase
        .from('oauth_tokens')
        .select('provider, access_token, refresh_token, expires_at')
        .eq('user_id', userId)

    const tokens: Record<string, DecryptedTokens> = {}
    for (const row of tokenRows ?? []) {
        try {
            tokens[row.provider as string] = {
                accessToken: decryptTokenFromDb(row.access_token as string),
                refreshToken: row.refresh_token ? decryptTokenFromDb(row.refresh_token as string) : null,
                expiresAt: (row.expires_at as string) ?? null,
            }
        } catch {
            // Undecryptable token row — skip rather than kill the chat.
        }
    }
    if (!tokens.google && !tokens.paybox) return null

    return {
        userId,
        telegramId: 0, // iMessage-origin context: no Telegram identity
        telegramChatId: 0,
        name: (user?.name as string | null) ?? '',
        // iMessage beta is US/East; users rows created via Spectrum binding
        // carry the schema default 'UTC', which would render "today" wrong.
        timezone: ((user?.timezone as string | null) ?? '') !== 'UTC' && user?.timezone
            ? (user.timezone as string)
            : 'America/New_York',
        tokens,
    }
}
