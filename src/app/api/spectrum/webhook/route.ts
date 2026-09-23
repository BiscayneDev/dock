/**
 * Spectrum Cloud webhook: Dinghy's iMessage front door, serverless.
 *
 * Spectrum Cloud POSTs each inbound iMessage here, HMAC-signed with the
 * webhook signing secret. app.webhook() verifies the signature over the raw
 * body (401 on bad signature, 500 when no secret is configured), responds
 * 200, and invokes the handler fire-and-forget — the handler enqueues every
 * send in spectrum_outbox before attempting it, so nothing is lost if the
 * function dies mid-tail (see spectrum-sweep cron). The tail is kept alive
 * with after() so it isn't frozen once the response is sent.
 *
 * Inert until the webhook is registered with Spectrum Cloud (cutover).
 */

import { after } from 'next/server'
import { getSpectrumApp } from '@/lib/spectrum/app'
import { handleSpectrumMessage, type InboundMessage, type InboundSpace } from '@/lib/spectrum/handler'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// Headroom for the post-response tail: history load + LLM call + send.
export const maxDuration = 120
// Upper bound on waiting for the SDK to dispatch the handler after the 200.
const DISPATCH_WAIT_MS = 5_000

export async function POST(req: Request): Promise<Response> {
    let app
    try {
        app = await getSpectrumApp()
    } catch (err) {
        // Fail closed: without SPECTRUM_WEBHOOK_SECRET no delivery can be
        // verified, so the route refuses to serve.
        console.error('spectrum webhook config:', err instanceof Error ? err.message : String(err))
        return Response.json({ error: 'spectrum webhook not configured' }, { status: 500 })
    }
    // app.webhook() dispatches the handler fire-and-forget after computing
    // the 200. On Vercel an un-awaited tail is frozen once the response goes
    // out and only advances when another request lands on the instance, which
    // stretched replies to ~5 min. Track each dispatch and keep the function
    // alive for it with after() (waitUntil semantics).
    const pending: Promise<void>[] = []
    const res = await app.webhook(req, (space: unknown, message: unknown) => {
        const p = handleSpectrumMessage(space as InboundSpace, message as InboundMessage).catch((err) => {
            console.error('spectrum handler failed:', err instanceof Error ? err.message : String(err))
        })
        pending.push(p)
        return p
    })
    after(async () => {
        // The SDK resolves messages asynchronously before dispatching, so the
        // handler can start after webhook() returns. Only signed 200s carry
        // messages; wait briefly for dispatch, then for every handler.
        if (res.status !== 200) return
        const deadline = Date.now() + DISPATCH_WAIT_MS
        while (pending.length === 0 && Date.now() < deadline) {
            await new Promise((r) => setTimeout(r, 25))
        }
        let settled = 0
        while (settled < pending.length) {
            const batch = pending.slice(settled)
            settled = pending.length
            await Promise.allSettled(batch)
        }
    })
    return res
}
