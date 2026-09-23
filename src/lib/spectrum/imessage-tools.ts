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
import { webSearch } from '@/lib/tools/web'
import { weather } from '@/lib/tools/weather'
import { twitterSearch, twitterTimeline, twitterUserTweets } from '@/lib/tools/twitter'
import { xFreeTools, xSearchEnabled } from '@/lib/tools/x-free'
import { healthSleep, healthReadiness, healthActivity, healthHeartRate, healthSummary } from '@/lib/tools/health'
import { githubListRepos, githubGetRepo, githubListIssues, githubGetIssue, githubListPrs, githubGetPr, githubListNotifications } from '@/lib/tools/github'

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
    files: boolean
    /** weather (always) + web_search (when TAVILY_API_KEY is set). */
    live: boolean
    search: boolean
    /** X read tools (search, timeline, a user's posts) when X is connected. */
    x?: boolean
    /** Free X reads (post, profile, recent posts); always on. */
    xFree?: boolean
    /** x_search offered (burner cookies configured). */
    xSearch?: boolean
    /** GitHub read tools when GitHub is connected. */
    github?: boolean
    /** Oura or WHOOP health reads. */
    health?: boolean
}

/** GitHub reads only: no creating issues, commenting or merging from iMessage. */
export const IMESSAGE_GITHUB_TOOLS: Tool[] = [githubListRepos, githubGetRepo, githubListIssues, githubGetIssue, githubListPrs, githubGetPr, githubListNotifications]

/** Oura / WHOOP reads (whichever is connected). */
export const IMESSAGE_HEALTH_TOOLS: Tool[] = [healthSummary, healthSleep, healthReadiness, healthActivity, healthHeartRate]

/** X reads only: no posting, liking or DMs from iMessage. */
export const IMESSAGE_X_TOOLS: Tool[] = [twitterSearch, twitterTimeline, twitterUserTweets]

/** Web search is offered only when its key is configured. */
export function searchEnabled(): boolean {
    return Boolean(process.env.TAVILY_API_KEY)
}

/**
 * Live-info tools for every chat, bound or not: public data only, no user
 * accounts involved. weather needs no key; web_search needs TAVILY_API_KEY.
 */
export function liveInfoTools(): Tool[] {
    return [weather, ...(searchEnabled() ? [webSearch] : []), ...xFreeTools()]
}

/**
 * Context for chats with no bound user. Live-info tools ignore it; it only
 * satisfies the tool-loop signature. No tokens, so no account tool can run.
 */
export function guestToolContext(): UserContext {
    return { userId: '', telegramId: 0, telegramChatId: 0, name: '', timezone: 'America/New_York', tokens: {} }
}

export function capabilitiesFor(ctx: UserContext): ImessageCapabilities {
    return { google: Boolean(ctx.tokens.google), wallet: Boolean(ctx.tokens.paybox), files: true, live: true, search: searchEnabled(), x: Boolean(ctx.tokens.twitter), xFree: true, xSearch: xSearchEnabled(), github: Boolean(ctx.tokens.github), health: Boolean(ctx.tokens.oura || ctx.tokens.whoop) }
}

/**
 * The tool set for this user: live-info tools always, Google read tools
 * when Google is connected, PayBox wallet reads when PayBox is connected.
 * Read-only either way.
 */
export function toolsFor(ctx: UserContext): Tool[] {
    const caps = capabilitiesFor(ctx)
    return [
        ...liveInfoTools(),
        ...(caps.google ? IMESSAGE_READ_TOOLS : []),
        ...(caps.wallet ? WALLET_READ_TOOLS : []),
        ...(caps.x ? IMESSAGE_X_TOOLS : []),
        ...(caps.github ? IMESSAGE_GITHUB_TOOLS : []),
        ...(caps.health ? IMESSAGE_HEALTH_TOOLS : []),
    ]
}

/** Capabilities for an unbound chat: live info only. */
export function guestCapabilities(): ImessageCapabilities {
    return { google: false, wallet: false, files: false, live: true, search: searchEnabled(), x: false, xFree: true, xSearch: xSearchEnabled() }
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
    if (!tokens.google && !tokens.paybox && !tokens.twitter && !tokens.github && !tokens.oura && !tokens.whoop) return null

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
