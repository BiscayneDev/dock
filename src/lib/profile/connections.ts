/**
 * Read model for the Connections section of /profile. Metadata only: provider,
 * account label, granted scopes, dates. Token columns are never selected.
 * Every query is filtered by the signed-in owner.
 */
import { createServerClient } from '@/lib/supabase/server'

export interface ConnectionRow {
    provider: string
    name: string
    account: string | null
    primary: boolean
    can: string[]
    cannot: string
    connectedAt: string | null
    /** Whether Dinghy ends the grant at the provider when you disconnect. */
    revokesAtProvider: boolean
    manageUrl: string | null
}

export interface CapabilityView { id: string; label: string; mode: 'read' | 'write'; expiresAt: string; lastUsedAt: string | null }
export interface RunView { id: string; label: string; task: string; outcome: string | null; startedAt: string }
export interface Connections { accounts: ConnectionRow[]; capabilities: CapabilityView[]; runs: RunView[] }

interface Spec { name: string; can: (scopes: string[]) => string[]; cannot: string; revokes: boolean; manage: string | null }

const has = (scopes: string[], needle: string) => scopes.some((s) => s.includes(needle))

const SPECS: Record<string, Spec> = {
    google: {
        name: 'Google',
        can: (s) => [
            has(s, 'gmail.readonly') && 'Read your email',
            has(s, 'gmail.send') && 'Send email, only after you say yes',
            has(s, 'calendar.readonly') && 'Read your calendar',
            has(s, 'calendar.events') && 'Add or change events, only after you say yes',
        ].filter(Boolean) as string[],
        cannot: 'Cannot delete email or see Drive.',
        revokes: true,
        manage: 'https://myaccount.google.com/permissions',
    },
    github: { name: 'GitHub', can: () => ['Read repos, issues and pull requests', 'Read notifications'], cannot: 'Cannot push code or merge.', revokes: false, manage: 'https://github.com/settings/applications' },
    paybox: { name: 'PayBox', can: () => ['See wallet balances'], cannot: 'Cannot move money without your passkey approval.', revokes: false, manage: null },
    oura: { name: 'Oura', can: () => ['Read sleep, readiness and activity'], cannot: 'Cannot change anything.', revokes: false, manage: 'https://cloud.ouraring.com/account' },
    whoop: { name: 'WHOOP', can: () => ['Read recovery, sleep and strain'], cannot: 'Cannot change anything.', revokes: false, manage: null },
}

export const specFor = (provider: string): Spec | null => SPECS[provider.startsWith('google') ? 'google' : provider] ?? null
export const isKnownProvider = (provider: string): boolean => specFor(provider) !== null

export async function listConnections(userId: string, now = Date.now()): Promise<Connections> {
    const db = createServerClient()
    const since = new Date(now - 30 * 86400_000).toISOString()
    const [tokens, caps, runs] = await Promise.all([
        db.from('oauth_tokens').select('provider, scopes, provider_account_email, provider_account_id, created_at').eq('user_id', userId),
        db.from('user_capabilities').select('id, label, mode, expires_at, last_used_at').eq('user_id', userId).is('revoked_at', null).gt('expires_at', new Date(now).toISOString()).order('created_at', { ascending: false }),
        db.from('capability_runs').select('id, label, task, outcome, started_at').eq('user_id', userId).gte('started_at', since).order('started_at', { ascending: false }).limit(15),
    ])
    const accounts: ConnectionRow[] = []
    for (const t of (tokens.data ?? []) as Array<{ provider: string; scopes: string[] | null; provider_account_email: string | null; provider_account_id: string | null; created_at: string | null }>) {
        const spec = specFor(t.provider)
        if (!spec) continue
        accounts.push({
            provider: t.provider,
            name: spec.name,
            account: t.provider_account_email ?? t.provider_account_id ?? null,
            primary: t.provider === 'google',
            can: spec.can(t.scopes ?? []),
            cannot: spec.cannot,
            connectedAt: t.created_at,
            revokesAtProvider: spec.revokes,
            manageUrl: spec.manage,
        })
    }
    accounts.sort((a, b) => a.name.localeCompare(b.name) || Number(b.primary) - Number(a.primary))
    const capabilities = ((caps.data ?? []) as Array<{ id: string; label: string; mode: 'read' | 'write'; expires_at: string; last_used_at: string | null }>)
        .map((c) => ({ id: c.id, label: c.label, mode: c.mode, expiresAt: c.expires_at, lastUsedAt: c.last_used_at }))
    const runViews = ((runs.data ?? []) as Array<{ id: string; label: string; task: string; outcome: string | null; started_at: string }>)
        .map((r) => ({ id: r.id, label: r.label, task: r.task, outcome: r.outcome, startedAt: r.started_at }))
    return { accounts, capabilities, runs: runViews }
}
