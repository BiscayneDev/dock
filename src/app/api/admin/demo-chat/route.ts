import { NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { getAdminSession } from '@/lib/auth/admin'
import { createServerClient } from '@/lib/supabase/server'
import { demoGuid, demoSpace } from '@/lib/spectrum/demo-chat'
import { handleSpectrumMessage } from '@/lib/spectrum/handler'
import { createConnectLink, loadHistory } from '@/spectrum/store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

/**
 * Admin demo chat. Drives a synthetic `demo;-;<slug>` identity through the real
 * Dinghy handler with no phone and no iMessage send. The slug is the only
 * identity; it never maps to a real user's chat guid. GET returns history,
 * POST { slug, message } sends a message, POST { slug, connect: true } mints a
 * Google connect link for the demo chat.
 */
async function ensureAllowed(guid: string): Promise<void> {
    const db = createServerClient()
    await db.from('beta_allowlist').upsert({ chat_guid: guid, note: 'demo chat (admin)' }, { onConflict: 'chat_guid', ignoreDuplicates: true })
}

export async function GET(req: Request): Promise<NextResponse> {
    if (!(await getAdminSession())) return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
    const guid = demoGuid(new URL(req.url).searchParams.get('slug') ?? '')
    if (!guid) return NextResponse.json({ error: 'bad slug' }, { status: 400 })
    return NextResponse.json({ history: await loadHistory(guid, 60) })
}

export async function POST(req: Request): Promise<NextResponse> {
    if (!(await getAdminSession())) return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
    const body = (await req.json().catch(() => null)) as { slug?: unknown; message?: unknown; connect?: unknown } | null
    const guid = demoGuid(typeof body?.slug === 'string' ? body.slug : '')
    if (!guid) return NextResponse.json({ error: 'bad slug (a-z, 0-9, - _, 2-40 chars)' }, { status: 400 })
    await ensureAllowed(guid)
    if (body?.connect === true) {
        return NextResponse.json({ link: await createConnectLink(guid, 'connect my gmail') })
    }
    const text = typeof body?.message === 'string' ? body.message.trim() : ''
    if (!text || text.length > 2000) return NextResponse.json({ error: 'message required (max 2000 chars)' }, { status: 400 })
    const space = demoSpace(guid, { persist: false })
    await handleSpectrumMessage(space, {
        id: `demo-${randomUUID()}`,
        content: { type: 'text', text } as never,
        sender: { id: guid },
        timestamp: new Date(),
    })
    return NextResponse.json({ sent: space.sent, history: await loadHistory(guid, 60) })
}
