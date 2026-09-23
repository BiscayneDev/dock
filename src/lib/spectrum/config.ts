/**
 * Server-side Spectrum (iMessage front door) configuration for the
 * serverless deployment. Fail-closed: the webhook must never process an
 * unverified delivery, so a missing signing secret is a hard error.
 */

export interface SpectrumConfig {
    projectId: string
    projectSecret: string
    webhookSecret: string
}

export function getSpectrumConfig(env: NodeJS.ProcessEnv = process.env): SpectrumConfig {
    const projectId = env.SPECTRUM_PROJECT_ID
    const projectSecret = env.SPECTRUM_PROJECT_SECRET
    const webhookSecret = env.SPECTRUM_WEBHOOK_SECRET
    if (!projectId || !projectSecret) {
        throw new Error('SPECTRUM_PROJECT_ID and SPECTRUM_PROJECT_SECRET are required')
    }
    if (!webhookSecret) {
        // Fail closed: without the signing secret no delivery can be
        // verified, so the route must refuse to serve at all.
        throw new Error('SPECTRUM_WEBHOOK_SECRET is required (set after Spectrum webhook registration)')
    }
    return { projectId, projectSecret, webhookSecret }
}

export const GATEWAY_URL = process.env.SHIPYARD_GATEWAY_URL ?? 'https://shipyard-inference.vercel.app'
export const SHIPYARD_API_KEY = process.env.SHIPYARD_API_KEY
// Pinned Hopscotch-catalog model id (#22): every Dinghy call routes through
// Hopscotch (x-shipyard-provider: hopscotch). Override with SHIPYARD_MODEL.
export const SHIPYARD_MODEL = process.env.SHIPYARD_MODEL ?? 'anthropic/claude-haiku-4-5-20251001'

/** Outbox delivery lease: stealable after expiry, mirroring #21's resume lease. */
export const OUTBOX_LEASE_MS = 60 * 1000

/** Send retry backoff: 30s doubling to a 30 minute cap. */
export function computeBackoffMs(attempts: number): number {
    const exp = Math.min(Math.max(attempts, 1), 7)
    return Math.min(30_000 * 2 ** (exp - 1), 30 * 60 * 1000)
}
