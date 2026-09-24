/**
 * Private-beta gate for the public iMessage line (migration 020).
 *
 * Unknown chats get one short "invite only" notice (at most every 12h) and
 * can text an invite code to be allowlisted. The owner mints codes by
 * texting "invite" (or "invite 5" for a 5-use code). Codes are stored as
 * sha256 hashes; 5 wrong guesses lock a chat out for 24h.
 */

import { createHash, randomInt } from 'crypto'
import { createServerClient } from '@/lib/supabase/server'

export type BetaRole = 'owner' | 'member'

// No 0/O/1/I/L: codes get read off screens and retyped.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
// Either "XXXX-XXXX" anywhere in the message, or the whole message is the
// 8 characters (so ordinary 8-letter words mid-sentence don't count as guesses).
const CODE_DASHED_RE = /\b([a-hj-km-np-z2-9]{4})-([a-hj-km-np-z2-9]{4})\b/i
const CODE_BARE_RE = /^\s*(?:dinghy[-\s]?)?([a-hj-km-np-z2-9]{4})([a-hj-km-np-z2-9]{4})\s*[.!]?\s*$/i
const INVITE_CMD_RE = /^\s*(?:new\s+|make\s+(?:an?\s+)?|create\s+(?:an?\s+)?)?invite(?:\s+code)?(?:\s+(?:x\s*)?(\d{1,3})(?:\s+uses?)?)?\s*[.!?]*\s*$/i

export function hashInviteCode(code: string): string {
    return createHash('sha256').update(code.replace(/[^a-z0-9]/gi, '').toUpperCase()).digest('hex')
}

export function generateInviteCode(): string {
    let s = ''
    for (let i = 0; i < 8; i++) s += ALPHABET[randomInt(ALPHABET.length)]
    return `${s.slice(0, 4)}-${s.slice(4)}`
}

/** Invite-code-looking token in a message, normalized to XXXX-XXXX. */
export function extractInviteCode(text: string): string | null {
    const m = text.match(CODE_DASHED_RE) ?? text.match(CODE_BARE_RE)
    if (!m) return null
    return `${m[1]}-${m[2]}`.toUpperCase()
}

/** Owner command: returns the requested use count, or null when not a command. */
export function parseInviteCommand(text: string): number | null {
    const m = text.match(INVITE_CMD_RE)
    if (!m) return null
    const n = m[1] ? parseInt(m[1], 10) : 1
    return Math.max(1, Math.min(n, 100))
}

/** Allowlist role, null when not allowlisted. Throws on DB error (callers fail closed). */
export async function getBetaRole(chatGuid: string): Promise<BetaRole | null> {
    const { data, error } = await createServerClient().rpc('beta_role', { p_chat_guid: chatGuid })
    if (error) throw new Error(`beta_role failed: ${error.message}`)
    return (data as BetaRole | null) ?? null
}

export type RedeemResult = 'ok' | 'already' | 'invalid' | 'locked'

export async function redeemInvite(chatGuid: string, code: string): Promise<RedeemResult> {
    const { data, error } = await createServerClient().rpc('redeem_beta_invite', {
        p_chat_guid: chatGuid,
        p_code_hash: hashInviteCode(code),
    })
    if (error) throw new Error(`redeem_beta_invite failed: ${error.message}`)
    return data as RedeemResult
}

export async function claimGateNotice(chatGuid: string): Promise<boolean> {
    const { data, error } = await createServerClient().rpc('claim_beta_gate_notice', { p_chat_guid: chatGuid })
    if (error) throw new Error(`claim_beta_gate_notice failed: ${error.message}`)
    return data === true
}

/** Mints a code for the owner. Returns the plaintext code, or null if not the owner. */
export async function mintInvite(ownerChat: string, maxUses: number, note = 'minted from iMessage'): Promise<string | null> {
    const code = generateInviteCode()
    const { data, error } = await createServerClient().rpc('create_beta_invite', {
        p_owner_chat: ownerChat,
        p_code_hash: hashInviteCode(code),
        p_max_uses: maxUses,
        p_note: note,
    })
    if (error) throw new Error(`create_beta_invite failed: ${error.message}`)
    return data === true ? code : null
}

export const GATE_NOTICE =
    "Hi, this is Dinghy. We're in private beta right now. If you have an invite code, text it here. No code yet? Join the waitlist at getdinghy.sh."
export const GATE_INVALID = "That code didn't work. Double-check it, or join the waitlist at getdinghy.sh."
export const GATE_WELCOME =
    "You're in - welcome to Dinghy. Save the contact card below so I show up as Dinghy, then text me whatever you need."
