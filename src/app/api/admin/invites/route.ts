import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getAdminSession } from '@/lib/auth/admin'

const E164 = /^\+[1-9]\d{7,14}$/

export async function GET(): Promise<NextResponse> {
    const session = await getAdminSession()
    if (!session) return NextResponse.json({ error: 'Admin access required' }, { status: 403 })

    const supabase = createServerClient()
    const [{ data: grants }, { data: identities }, { data: activePeople }, { data: codes }] = await Promise.all([
        supabase.from('user_invite_grants').select('chat_guid, granted, updated_at').order('updated_at', { ascending: false }),
        supabase.from('spectrum_identities').select('chat_guid, handle'),
        supabase.from('waitlist').select('id, name, email, phone, status').eq('status', 'active').order('first_text_at', { ascending: false }),
        supabase.from('beta_invites').select('code_hash, note, max_uses, uses, created_at, expires_at, created_by_chat').order('created_at', { ascending: false }).limit(300),
    ])

    // phone -> chat_guid (a phone can appear on several chats; take the newest)
    const chatByPhone = new Map<string, string>()
    for (const row of identities ?? []) {
        const h = (row as { chat_guid: string; handle: string | null }).handle
        if (h && E164.test(h)) chatByPhone.set(h, (row as { chat_guid: string }).chat_guid)
    }

    const usedByChat = new Map<string, number>()
    for (const c of codes ?? []) {
        const chat = (c as { created_by_chat: string | null }).created_by_chat
        if (!chat) continue
        usedByChat.set(chat, (usedByChat.get(chat) ?? 0) + (c as { uses: number }).uses)
    }

    const people = (activePeople ?? []).map((w) => {
        const p = w as { id: string; name: string | null; email: string; phone: string | null }
        const chat = p.phone ? chatByPhone.get(p.phone) ?? null : null
        const grant = (grants ?? []).find((g) => (g as { chat_guid: string }).chat_guid === chat) as { granted: number } | undefined
        return {
            id: p.id, name: p.name, email: p.email, phone: p.phone,
            chatGuid: chat,
            granted: grant?.granted ?? 0,
            used: chat ? usedByChat.get(chat) ?? 0 : 0,
            remaining: chat ? Math.max(0, (grant?.granted ?? 0) - (usedByChat.get(chat) ?? 0)) : 0,
        }
    })

    return NextResponse.json({ people })
}

export async function POST(req: Request): Promise<NextResponse> {
    const session = await getAdminSession()
    if (!session) return NextResponse.json({ error: 'Admin access required' }, { status: 403 })

    const body = await req.json().catch(() => null) as { phone?: string; email?: string; chatGuid?: string; amount?: number } | null
    const amount = Number(body?.amount)
    if (!Number.isInteger(amount) || amount < 1 || amount > 100) {
        return NextResponse.json({ error: 'amount must be 1-100' }, { status: 400 })
    }

    const supabase = createServerClient()
    let chatGuid: string | null = null

    if (body?.chatGuid) {
        chatGuid = body.chatGuid
    } else {
        const phone = body?.phone?.replace(/[^+\d]/g, '')
        const email = body?.email?.trim().toLowerCase()
        if (phone && E164.test(phone)) {
            chatGuid = `any;-;${phone}`
        } else if (email) {
            const { data } = await supabase.from('waitlist').select('phone').eq('email', email).eq('status', 'active').limit(1).maybeSingle()
            const p = (data as { phone: string | null } | null)?.phone
            if (p) chatGuid = `any;-;${p}`
        }
    }

    if (!chatGuid) return NextResponse.json({ error: 'Could not resolve that member. Give their active phone or email.' }, { status: 404 })

    const { data: allowlisted } = await supabase.from('beta_allowlist').select('chat_guid').eq('chat_guid', chatGuid).maybeSingle()
    if (!allowlisted) return NextResponse.json({ error: 'That chat is not on the beta allowlist yet.' }, { status: 404 })

    const { error: rpcError } = await supabase.rpc('add_user_invite_grant', { p_chat_guid: chatGuid, p_amount: amount })
    if (rpcError) return NextResponse.json({ error: rpcError.message }, { status: 500 })

    const { data: after } = await supabase.from('user_invite_grants').select('granted').eq('chat_guid', chatGuid).maybeSingle()
    return NextResponse.json({ ok: true, chatGuid, granted: (after as { granted: number } | null)?.granted ?? amount })
}
