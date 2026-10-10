/**
 * Provider-side token revocation. Deleting our copy of a token does not end the
 * grant at the provider: the token keeps working for anyone who has it. Google
 * supports a plain revoke endpoint, so we call it. Other providers are deleted
 * locally only; the Connections page says so and links to their own settings.
 */
export type RevokeResult = 'revoked' | 'not_supported' | 'failed'

export const GOOGLE_REVOKE_URL = 'https://oauth2.googleapis.com/revoke'

export async function revokeGoogleToken(token: string | null | undefined): Promise<RevokeResult> {
    if (!token) return 'failed'
    try {
        const res = await fetch(GOOGLE_REVOKE_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ token }).toString(),
            signal: AbortSignal.timeout(5000),
        })
        // 400 invalid_token means it is already revoked or expired: nothing left to end.
        if (res.ok || res.status === 400) return 'revoked'
        return 'failed'
    } catch {
        return 'failed'
    }
}
