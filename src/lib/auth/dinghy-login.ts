/**
 * Dinghy web sign-in: phone -> code texted into the user's own Dinghy
 * iMessage thread -> session. Modeled on text-a-code sign-ins.
 *
 * Only numbers that already have a Dinghy thread on the beta allowlist (or
 * an existing bound account) can get a code; everyone else gets the same
 * "check your texts" response, so the form never reveals who is a member.
 */
import { createHash, randomInt } from 'crypto'
import { createServerClient } from '@/lib/supabase/server'

export const LOGIN_CODE_TTL_S = 10 * 60

/** US-first E.164 normalization. Returns null for anything that isn't a phone number. */
export function normalizePhone(input: string): string | null {
    const raw = input.trim()
    const digits = raw.replace(/\D/g, '')
    if (raw.startsWith('+')) return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null
    if (digits.length === 10) return `+1${digits}`
    if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
    return null
}

export function hashLoginCode(phone: string, code: string): string {
    return createHash('sha256').update(`${phone}:${code.replace(/\D/g, '')}`).digest('hex')
}

export function generateLoginCode(): string {
    return String(randomInt(0, 1_000_000)).padStart(6, '0')
}

export function loginCodeText(code: string): string {
    return `${code} is your dinghy sign-in code. it expires in 10 minutes. didn't try to sign in at getdinghy.sh? ignore this.`
}

/** The Dinghy chat for this phone, if it may sign in (bound, or on the beta allowlist). */
export async function eligibleChatFor(phone: string): Promise<string | null> {
    const supabase = createServerClient()
    const { data: rows } = await supabase
        .from('spectrum_identities')
        .select('chat_guid, user_id, created_at')
        .eq('handle', phone)
        .order('created_at', { ascending: false })
    const list = (rows ?? []) as Array<{ chat_guid: string; user_id: string | null }>
    const bound = list.find((r) => r.user_id)
    if (bound) return bound.chat_guid
    for (const r of list) {
        const { data: allowed } = await supabase.from('beta_allowlist').select('chat_guid').eq('chat_guid', r.chat_guid).maybeSingle()
        if (allowed) return r.chat_guid
    }
    return null
}

/** Mint + text a code. Never throws on "not eligible"; returns whether a code went out. */
export async function startLogin(
    phone: string,
    send: (chatGuid: string, text: string) => Promise<void>
): Promise<{ sent: boolean; limited?: boolean }> {
    const chatGuid = await eligibleChatFor(phone)
    if (!chatGuid) return { sent: false }
    const code = generateLoginCode()
    const { data, error } = await createServerClient().rpc('dinghy_login_code_create', {
        p_phone: phone,
        p_chat_guid: chatGuid,
        p_code_hash: hashLoginCode(phone, code),
        p_ttl_seconds: LOGIN_CODE_TTL_S,
    })
    if (error) throw new Error(`dinghy_login_code_create failed: ${error.message}`)
    if (data !== true) return { sent: false, limited: true }
    await send(chatGuid, loginCodeText(code))
    return { sent: true }
}

/** Check a code. Returns the chat guid on success, null otherwise. */
export async function verifyLogin(phone: string, code: string): Promise<string | null> {
    if (!/^\d{6}$/.test(code.replace(/\D/g, ''))) return null
    const { data, error } = await createServerClient().rpc('dinghy_login_code_verify', {
        p_phone: phone,
        p_code_hash: hashLoginCode(phone, code),
    })
    if (error) throw new Error(`dinghy_login_code_verify failed: ${error.message}`)
    return typeof data === 'string' && data ? data : null
}
