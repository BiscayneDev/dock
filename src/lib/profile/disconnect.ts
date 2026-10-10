import { createServerClient } from '@/lib/supabase/server'
import { disconnectGoogleAccount } from '@/lib/integrations/google'
import { isKnownProvider } from '@/lib/profile/connections'

export interface DisconnectOutcome { ok: boolean; name: string; revokedAtProvider: boolean }

/** Disconnect one of the signed-in user's connections. Only rows owned by userId are touched. */
export async function disconnectConnection(userId: string, provider: string): Promise<DisconnectOutcome | null> {
    if (!isKnownProvider(provider)) return null
    const db = createServerClient()
    const { data: row } = await db
        .from('oauth_tokens')
        .select('provider, provider_account_email')
        .eq('user_id', userId)
        .eq('provider', provider)
        .maybeSingle()
    if (!row) return null
    if (provider === 'google' || provider.startsWith('google:')) {
        const email = String(row.provider_account_email ?? '')
        if (!email) return null
        const ok = await disconnectGoogleAccount(userId, email)
        return ok ? { ok, name: 'Google', revokedAtProvider: true } : null
    }
    const { error } = await db.from('oauth_tokens').delete().eq('user_id', userId).eq('provider', provider)
    if (error) throw new Error('Failed to disconnect')
    return { ok: true, name: provider, revokedAtProvider: false }
}
