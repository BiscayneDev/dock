/**
 * Spectrum Cloud webhook: Dinghy's iMessage front door, serverless.
 *
 * Spectrum Cloud POSTs each inbound iMessage here, HMAC-signed with the
 * webhook signing secret. app.webhook() verifies the signature over the raw
 * body (401 on bad signature, 500 when no secret is configured), responds
 * 200, and invokes the handler fire-and-forget — the handler enqueues every
 * send in spectrum_outbox before attempting it, so nothing is lost if the
 * function dies mid-tail (see spectrum-sweep cron).
 *
 * Inert until the webhook is registered with Spectrum Cloud (cutover).
 */

import { getSpectrumApp } from '@/lib/spectrum/app'
import { handleSpectrumMessage, type InboundMessage, type InboundSpace } from '@/lib/spectrum/handler'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// Headroom for the post-response tail: history load + LLM call + send.
export const maxDuration = 120

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
    return app.webhook(req, async (space: unknown, message: unknown) => {
        await handleSpectrumMessage(space as InboundSpace, message as InboundMessage)
    })
}
