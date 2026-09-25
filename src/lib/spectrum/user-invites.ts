/**
 * Member invite links.
 *
 * An allowlisted member with grants left texts Dinghy "invite" and gets a
 * shareable link (https://getdinghy.sh/i/XXXX-XXXX). The recipient opens
 * the link and taps through to text the code to Dinghy's public line,
 * where the existing beta gate (beta-gate.ts, migration 020) redeems it
 * and allowlists them. Every redemption burns one of the member's grants.
 *
 * Admin grants live in user_invite_grants (migration 053); the balance is
 * granted minus total redemptions across the member's codes.
 */

import { createServerClient } from '@/lib/supabase/server'
import { generateInviteCode, hashInviteCode } from './beta-gate'

/** The public iMessage line link recipients text (docs/imessage-front-door.md). */
export const PUBLIC_DINGHY_LINE = process.env.NEXT_PUBLIC_DINGHY_LINE ?? '+16282647754'

export function inviteLink(code: string): string {
    const base = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') || 'https://www.getdinghy.sh'
    return `${base}/i/${encodeURIComponent(code)}`
}

/** True for "invites", "my invites", "invite status", "invites left". */
export function isInviteStatusCommand(text: string): boolean {
    return /^\s*(?:my\s+invites?|invite\s+(?:status|left)|invites(?:\s+left)?)\s*[.!?]*\s*$/i.test(text)
}

export interface InviteBalance {
    granted: number
    used: number
    remaining: number
}

export async function inviteBalance(chatGuid: string): Promise<InviteBalance> {
    const supabase = createServerClient()
    const { data, error } = await supabase.rpc('user_invite_remaining', { p_chat_guid: chatGuid })
    if (error) throw new Error(`user_invite_remaining failed: ${error.message}`)
    const remaining = (data as number | null) ?? 0
    // granted - remaining = used; granted lives in the grants table.
    const { data: grantRow } = await supabase.from('user_invite_grants')
        .select('granted').eq('chat_guid', chatGuid).maybeSingle()
    const granted = grantRow?.granted ?? 0
    return { granted, used: Math.max(0, granted - remaining), remaining }
}

export interface MintResult {
    ok: boolean
    remaining: number
    code?: string
    link?: string
}

/** Mints a shareable link for a member. ok=false when out of invites. */
export async function mintMemberInvite(chatGuid: string, uses: number, note = 'member invite link'): Promise<MintResult> {
    const code = generateInviteCode()
    const supabase = createServerClient()
    const { data, error } = await supabase.rpc('mint_user_invite', {
        p_chat_guid: chatGuid,
        p_code_hash: hashInviteCode(code),
        p_uses: Math.max(1, Math.min(uses, 100)),
        p_note: note,
    })
    if (error) throw new Error(`mint_user_invite failed: ${error.message}`)
    const remaining = (data as number) ?? -1
    if (remaining < 0) return { ok: false, remaining: 0 }
    return { ok: true, remaining, code, link: inviteLink(code) }
}

export function balanceText(balance: InviteBalance): string {
    if (balance.granted === 0) {
        return "You don't have any invites yet. Text INVITE MORE and I'll pass the request along."
    }
    if (balance.remaining === 0) {
        return "You've used all your invites. Text INVITE MORE and I'll pass the request along."
    }
    return `You have ${balance.remaining} invite${balance.remaining === 1 ? '' : 's'} left. Text "invite" and I'll make you a shareable link.`
}
