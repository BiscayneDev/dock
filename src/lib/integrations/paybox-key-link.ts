/**
 * PayBox signing-key setup for chat users (iMessage), in two links:
 *
 *   1. PayBox's own "generate signing key" page for this agent:
 *      <app>/agent-key?client_id=<cid>. The cid is the vault agent id carried
 *      in the access token's `cid` claim (never the pbx-oauth- client id);
 *      same URL the @paybox-sh/sdk CLI opens during `paybox login`. On a
 *      phone it opens the PayBox app.
 *   2. A one-use Dinghy page with a masked field to paste the pbxk1. key.
 *      The key is validated, encrypted onto oauth_tokens.signing_key, and
 *      never passes through the chat.
 *
 * With a key on file, the SDK signs in-process: immediately under an
 * autonomous grant, or after the user's passkey approval for swaps/x402.
 */

import { createHash, randomBytes } from 'crypto'
import { credsFromToken } from '@paybox-sh/sdk'
import { createServerClient } from '@/lib/supabase/server'
import { getPayboxAccessToken, getPayboxAppUrl, getPayboxSigningKey, storePayboxSigningKey } from '@/lib/integrations/paybox'
import { enqueueOutbox } from '@/lib/spectrum/outbox'
import type { DecryptedTokens } from '@/lib/llm/types'

export const KEY_LINK_TTL_SECONDS = 15 * 60

export const KEY_SAVED_ACK =
    "signing key saved. swaps and payments now finish right after you approve with your passkey in paybox. revoke it any time from paybox's clients screen."

const hash = (t: string): string => createHash('sha256').update(t).digest('hex')

/** The vault agent id (`cid`) from a PayBox access token, or null. */
export function agentCid(accessToken: string): string | null {
    const payload = accessToken.split('.')[1]
    if (!payload) return null
    try {
        const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { cid?: unknown }
        return typeof claims.cid === 'string' && claims.cid ? claims.cid : null
    } catch {
        return null
    }
}

export function agentKeyUrl(cid: string): string {
    return `${getPayboxAppUrl()}/agent-key?client_id=${encodeURIComponent(cid)}`
}

/** Validate a pasted key without storing it. Returns an error string or null. */
export function checkSigningKey(raw: string): string | null {
    const key = raw.trim()
    if (!key) return 'Paste the key from PayBox.'
    if (key.startsWith('pbx_live_')) return "That's a PayBox API key. Paste the signing key, which starts with pbxk1."
    if (!key.startsWith('pbxk1.')) return 'That doesn\'t look like a signing key. It starts with pbxk1.'
    try {
        credsFromToken(key)
        return null
    } catch {
        return "That key didn't check out. Copy it again from PayBox and paste the whole thing."
    }
}

export interface KeySetupLinks {
    generateUrl: string
    pasteUrl: string
    alreadyHasKey: boolean
}

/** Mint both links for a chat's bound user. Throws if PayBox isn't usable. */
export async function mintKeySetupLinks(userId: string, tokens: DecryptedTokens, chatGuid: string | null): Promise<KeySetupLinks> {
    const accessToken = await getPayboxAccessToken(tokens, userId)
    const cid = agentCid(accessToken)
    if (!cid) throw new Error('PayBox token has no agent id; reconnect PayBox')
    const token = randomBytes(24).toString('base64url')
    const supabase = createServerClient()
    const { error } = await supabase.rpc('create_paybox_key_link', {
        p_hash: hash(token),
        p_user: userId,
        p_chat: chatGuid,
        p_ttl_seconds: KEY_LINK_TTL_SECONDS,
    })
    if (error) throw new Error(`key link create failed: ${error.message}`)
    const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.getdinghy.sh').replace(/\/+$/, '')
    return {
        generateUrl: agentKeyUrl(cid),
        pasteUrl: `${appUrl}/connect/paybox/key?t=${token}`,
        alreadyHasKey: Boolean(await getPayboxSigningKey(userId).catch(() => null)),
    }
}

/** Is this paste link still usable? (for the page, before showing the form) */
export async function keyLinkIsLive(token: string): Promise<boolean> {
    if (!token) return false
    const { data } = await createServerClient().rpc('peek_paybox_key_link', { p_hash: hash(token) })
    return Array.isArray(data) && data.length > 0
}

export type RedeemResult = { ok: true } | { ok: false; error: string; status: number }

/** Validate the key, then use the link once and store the key encrypted. */
export async function redeemKeyLink(token: string, rawKey: string): Promise<RedeemResult> {
    const bad = checkSigningKey(rawKey)
    if (bad) return { ok: false, error: bad, status: 400 }
    if (!(await keyLinkIsLive(token))) {
        return { ok: false, error: 'This link expired or was already used. Ask Dinghy for a fresh one.', status: 410 }
    }
    const supabase = createServerClient()
    const { data, error } = await supabase.rpc('consume_paybox_key_link', { p_hash: hash(token) })
    const row = Array.isArray(data) ? (data[0] as { user_id: string; chat_guid: string | null } | undefined) : undefined
    if (error || !row) {
        return { ok: false, error: 'This link expired or was already used. Ask Dinghy for a fresh one.', status: 410 }
    }
    try {
        await storePayboxSigningKey(row.user_id, rawKey.trim())
    } catch (err) {
        console.error('signing key store failed:', err instanceof Error ? err.message : String(err))
        return { ok: false, error: "Couldn't save the key. Is PayBox still connected? Ask Dinghy for a fresh link.", status: 500 }
    }
    if (row.chat_guid) await enqueueOutbox(row.chat_guid, 'reply', KEY_SAVED_ACK).catch(() => null)
    return { ok: true }
}
