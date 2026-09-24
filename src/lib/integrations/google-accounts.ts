/**
 * Multiple Google accounts per user.
 *
 * Storage keeps oauth_tokens' unique(user_id, provider): the primary
 * account is provider 'google' (so every existing single-account consumer
 * keeps working), extra accounts are 'google:<email>'. Switching primary is
 * a provider swap (set_primary_google, migration 047).
 *
 * Tools stay single-account; multiAccount() wraps them with an optional
 * `account` input and decides which mailbox/calendar to use:
 *  - 'all'     reads (search, inbox summary, events): every account unless one is named
 *  - 'find'    item ops (read, reply, get event): the named account, else try each until one has it
 *  - 'primary' new outbound (send, create event): the named account, else the primary
 */

import type { DecryptedTokens, Tool, ToolResult, UserContext } from '@/lib/llm/types'

export interface GoogleAccount {
    email: string
    provider: string
    primary: boolean
    tokens: DecryptedTokens
}

export const isGoogleProvider = (p: string): boolean => p === 'google' || p.startsWith('google:')
export const extraGoogleProvider = (email: string): string => `google:${email.trim().toLowerCase()}`

/** Accounts from the loaded token map; primary first. */
export function googleAccountsOf(ctx: Pick<UserContext, 'tokens'>): GoogleAccount[] {
    const out: GoogleAccount[] = []
    for (const [provider, tokens] of Object.entries(ctx.tokens ?? {})) {
        if (!isGoogleProvider(provider)) continue
        const email = (tokens.email ?? (provider === 'google' ? '' : provider.slice('google:'.length))).toLowerCase()
        out.push({ email, provider, primary: provider === 'google', tokens: { ...tokens, provider } })
    }
    return out.sort((a, b) => Number(b.primary) - Number(a.primary) || a.email.localeCompare(b.email))
}

/** Match "work", "biscayne", a full address or its local part to one account. */
export function resolveAccount(accounts: GoogleAccount[], query: unknown): GoogleAccount | null | 'ambiguous' {
    const q = typeof query === 'string' ? query.trim().toLowerCase() : ''
    if (!q) return null
    const exact = accounts.find((a) => a.email === q)
    if (exact) return exact
    const hits = accounts.filter((a) => a.email.includes(q) || (q === 'primary' && a.primary) || (q === 'main' && a.primary))
    if (hits.length === 1) return hits[0]
    return hits.length ? 'ambiguous' : null
}

/** The same context, pointed at one account (tokens.google = that account). */
export function withAccount(ctx: UserContext, account: GoogleAccount): UserContext {
    return { ...ctx, tokens: { ...ctx.tokens, google: account.tokens } }
}

export type AccountMode = 'all' | 'find' | 'primary'

const ACCOUNT_PROP = {
    type: 'string',
    description: 'Which Gmail/Google account (email address, or part of it like "biscayne"). Omit for the default.',
}

export function multiAccount(tool: Tool, mode: AccountMode): Tool {
    // Unit tests mock tool modules partially; pass missing tools through.
    if (!tool) return tool
    const props = ((tool.inputSchema as { properties?: Record<string, unknown> } | undefined)?.properties ?? {}) as Record<string, unknown>
    return {
        ...tool,
        inputSchema: { ...tool.inputSchema, properties: { ...props, account: ACCOUNT_PROP } },
        async execute(input: unknown, ctx: UserContext): Promise<ToolResult> {
            const { account: named, ...rest } = ((input ?? {}) as Record<string, unknown>)
            const accounts = googleAccountsOf(ctx)
            if (accounts.length <= 1) return tool.execute(rest, ctx)

            const picked = resolveAccount(accounts, named)
            if (picked === 'ambiguous') return { success: false, error: `"${String(named)}" matches more than one account: ${accounts.map((a) => a.email).join(', ')}` }
            if (named && !picked) return { success: false, error: `no connected account matches "${String(named)}". connected: ${accounts.map((a) => a.email).join(', ')}` }
            if (picked) return tag(await tool.execute(rest, withAccount(ctx, picked)), picked)

            if (mode === 'primary') return tag(await tool.execute(rest, withAccount(ctx, accounts[0])), accounts[0])

            if (mode === 'find') {
                let last: ToolResult = { success: false, error: 'not found in any connected account' }
                for (const a of accounts) {
                    const r = await tool.execute(rest, withAccount(ctx, a))
                    if (r.success) return tag(r, a)
                    last = r
                }
                return last
            }

            const results = await Promise.all(accounts.map(async (a) => ({ a, r: await tool.execute(rest, withAccount(ctx, a)) })))
            const ok = results.filter((x) => x.r.success)
            if (!ok.length) return results[0].r
            return {
                success: true,
                data: {
                    accounts: results.map(({ a, r }) => (r.success ? { account: a.email, ...asObject(r.data) } : { account: a.email, error: r.error })),
                },
            }
        },
    }
}

function asObject(data: unknown): Record<string, unknown> {
    if (data && typeof data === 'object' && !Array.isArray(data)) return data as Record<string, unknown>
    return { result: data }
}

function tag(r: ToolResult, a: GoogleAccount): ToolResult {
    return r.success ? { ...r, data: { account: a.email, ...asObject(r.data) } } : r
}

/** One prompt line naming the connected accounts (only when there are several). */
export function accountsLine(ctx: Pick<UserContext, 'tokens'>): string {
    const accounts = googleAccountsOf(ctx)
    if (accounts.length === 0) return ''
    if (accounts.length === 1) {
        return (
            `They have exactly 1 Google account connected: ${accounts[0].email}. ` +
            'That is the only inbox and calendar you can see. Never say a second account is connected unless it appears in this list, even if they say they connected one - ' +
            'if they think they added another, tell them you only see this one and offer the connect link again.'
        )
    }
    const list = accounts.map((a) => (a.primary ? `${a.email} (primary)` : a.email)).join(', ')
    return (
        `They have ${accounts.length} Google accounts connected: ${list}. ` +
        'Email and calendar tools take an optional account. Searches, inbox summaries and calendar reads cover every account unless they name one, and results say which account each item came from. ' +
        'Pass that same account when you read, reply to or change an item. New emails and events go from the primary unless they say otherwise, e.g. "from my biscayne email".'
    )
}
