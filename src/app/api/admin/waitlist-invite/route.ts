import { NextResponse } from 'next/server'
import { getAdminSession } from '@/lib/auth/admin'
import { MAX_INVITES_PER_COMMAND, parseWaitlistInviteCommand, runWaitlistInvites } from '@/lib/spectrum/waitlist-invites'

/**
 * Admin waitlist invite: the same flow as the owner texting "invite <email>"
 * or "invite next N" to Dinghy (line assignment, allowlist, intro text, invite
 * email). Admin session only. Body: { email } or { next: N }.
 */
export async function POST(req: Request): Promise<NextResponse> {
    const session = await getAdminSession()
    if (!session) return NextResponse.json({ error: 'Admin access required' }, { status: 403 })

    const body = (await req.json().catch(() => null)) as { email?: unknown; next?: unknown } | null
    let command: string | null = null
    if (typeof body?.email === 'string' && body.email.trim()) {
        command = `invite ${body.email.trim()}`
    } else if (Number.isInteger(body?.next) && (body!.next as number) >= 1 && (body!.next as number) <= MAX_INVITES_PER_COMMAND) {
        command = `invite next ${body!.next}`
    }
    const cmd = command ? parseWaitlistInviteCommand(command) : null
    if (!cmd) {
        return NextResponse.json({ error: `Give an email, or next (1-${MAX_INVITES_PER_COMMAND}).` }, { status: 400 })
    }

    try {
        const result = await runWaitlistInvites(`admin:${session.userId}`, cmd)
        return NextResponse.json({ ok: true, result })
    } catch (err) {
        return NextResponse.json({ error: err instanceof Error ? err.message : 'invite failed' }, { status: 500 })
    }
}
