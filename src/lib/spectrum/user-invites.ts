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

export interface OwnerInviteStats {
    links_made: number
    spots_made: number
    redeemed: number
    open_spots: number
}

/** The owner has no cap, but "how many have I given out and used" is a real answer. */
export async function ownerInviteStats(chatGuid: string): Promise<OwnerInviteStats | Record<string, never>> {
    const { data, error } = await createServerClient()
        .from('beta_invites')
        .select('max_uses, uses, expires_at')
        .eq('created_by_chat', chatGuid)
    if (error || !data) return {}
    const now = Date.now()
    const rows = data as { max_uses: number; uses: number; expires_at: string }[]
    return {
        links_made: rows.length,
        spots_made: rows.reduce((n, r) => n + r.max_uses, 0),
        redeemed: rows.reduce((n, r) => n + r.uses, 0),
        open_spots: rows.reduce((n, r) => (new Date(r.expires_at).getTime() > now ? n + Math.max(0, r.max_uses - r.uses) : n), 0),
    }
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

// ── Model-facing invite tools ───────────────────────────────────────────────
// So "can I bring a friend?", "do I have invites?" and "give me my invite link"
// work in any wording, not just the exact "invite" command. Numbers always come
// from the database; the link is only minted when the user asks for it, because
// minting reserves invites from their allowance.

import type { Tool, ToolResult } from '@/lib/llm/types'
import { mintInvite } from './beta-gate'

const RECENT_MS = 2 * 60 * 1000
const recent = new Map<string, { link: string; remaining: number | null; uses: number; at: number }>()

export type InviteRole = 'owner' | 'member'

/** One line of prompt knowledge, only when there is something to give. */
export function invitesPromptLine(left: number | 'unlimited'): string {
    const have = left === 'unlimited' ? 'You can give out invites to Dinghy' : `You have ${left} invite${left === 1 ? '' : 's'} to give out`
    return (
        `${have}. Call invite_status before you quote any number about invites and never guess one. ` +
        'Mention it at most once on your own, at a natural moment: they say Dinghy is great or useful, or ask about sharing or bringing someone in. ' +
        'Do not bring it up again if it is already in this chat, and never push it. ' +
        'When they ask for the link or want to invite someone, call invite_link and put the returned link alone on the last line. ' +
        'Only call invite_link when they ask for it, because each link reserves invites from their allowance.' +
        (left === 'unlimited' ? ' This person has no cap: when they ask how many invites they have, say unlimited and give the real links made, redeemed and open spots from invite_status.' : '')
    )
}

export function inviteToolsFor(chatGuid: string, role: InviteRole): Tool[] {
    const status: Tool = {
        name: 'invite_status',
        description: "Read how many Dinghy invites this person has left to give out. Read-only; does not make a link. Use it before quoting any invite number.",
        inputSchema: { type: 'object', properties: {} },
        async execute(): Promise<ToolResult> {
            try {
                if (role === 'owner') return { success: true, data: { remaining: 'unlimited', note: 'owner: no allowance limit', ...(await ownerInviteStats(chatGuid)) } }
                const b = await inviteBalance(chatGuid)
                return { success: true, data: { granted: b.granted, used: b.used, remaining: b.remaining } }
            } catch (err) {
                return { success: false, error: err instanceof Error ? err.message : String(err) }
            }
        },
    }
    const link: Tool = {
        name: 'invite_link',
        description:
            'Make a shareable Dinghy invite link for this person. Only call it when they ask for the link or say they want to invite someone. Default 1 person; pass people for more. It reserves that many invites from their allowance. Put the returned link alone on the last line of your reply. Never invent or retype a link.',
        inputSchema: { type: 'object', properties: { people: { type: 'integer', minimum: 1, maximum: 10, description: 'How many people this link admits (default 1).' } } },
        async execute(input: unknown): Promise<ToolResult> {
            try {
                const raw = (input as { people?: unknown } | null)?.people
                const uses = Number.isInteger(raw) ? Math.max(1, Math.min(raw as number, 10)) : 1
                // A model retry inside one turn must not burn a second invite.
                const prev = recent.get(chatGuid)
                if (prev && prev.uses === uses && Date.now() - prev.at < RECENT_MS) {
                    return { success: true, data: { link: prev.link, people: uses, remaining_after: prev.remaining, note: 'same link as a moment ago' } }
                }
                if (role === 'owner') {
                    const code = await mintInvite(chatGuid, uses)
                    if (!code) return { success: false, error: 'could not make an invite code' }
                    const l = inviteLink(code)
                    recent.set(chatGuid, { link: l, remaining: null, uses, at: Date.now() })
                    return { success: true, data: { link: l, people: uses, remaining_after: 'unlimited', expires: '30 days' } }
                }
                const mint = await mintMemberInvite(chatGuid, uses)
                if (!mint.ok) return { success: false, error: `not enough invites left for ${uses}; call invite_status for the real number` }
                recent.set(chatGuid, { link: mint.link as string, remaining: mint.remaining, uses, at: Date.now() })
                return { success: true, data: { link: mint.link, people: uses, remaining_after: mint.remaining, expires: '30 days' } }
            } catch (err) {
                return { success: false, error: err instanceof Error ? err.message : String(err) }
            }
        },
    }
    return [status, link]
}
