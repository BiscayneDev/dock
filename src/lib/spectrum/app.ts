/**
 * Spectrum app singleton for the serverless deployment. One app per lambda
 * instance; the async init promise is cached (and dropped on failure so the
 * next request retries).
 */

import { Spectrum } from 'spectrum-ts'
import { imessage } from '@spectrum-ts/imessage'
import { getSpectrumConfig } from './config'

export type SpectrumApp = Awaited<ReturnType<typeof Spectrum>>
export type IMessageProvider = ReturnType<typeof imessage>

let appPromise: Promise<SpectrumApp> | null = null

export function getSpectrumApp(): Promise<SpectrumApp> {
    if (!appPromise) {
        const cfg = getSpectrumConfig() // throws (fail closed) when unset
        appPromise = Spectrum({
            projectId: cfg.projectId,
            projectSecret: cfg.projectSecret,
            providers: [imessage.config()],
            webhookSecret: cfg.webhookSecret,
        })
        appPromise.catch(() => {
            appPromise = null
        })
    }
    return appPromise
}

/** iMessage provider bound to the app: space.get(chatGuid) for proactive sends. */
export async function getImessage(app: SpectrumApp): Promise<IMessageProvider> {
    return imessage(app)
}
