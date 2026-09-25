/**
 * Task-aware model routing through Shipyard (Halsey, Sep 24: "Dinghy is
 * supposed to run on the right model for the task being asked via shipyard",
 * then 9:09 PM: "We should be using Jev for the model selection").
 *
 * Dinghy sends model "auto" and nothing else about the task. Shipyard's Jev
 * judges each request's tier from the latest user message (casual -> economy,
 * research/news/comparisons/corrections -> frontier, the rest its call), then
 * picks the cheapest capable model in that tier. Dinghy only restricts which
 * providers are allowed: traffic stays on Hopscotch (Halsey, Sep 22: "We should
 * be using it in dinghy").
 *
 * DINGHY_MODEL_ROUTING=off falls back to the pinned SHIPYARD_MODEL.
 * DINGHY_PROVIDERS overrides the candidate allowlist (comma-separated).
 */

export interface RoutingPrefs {
    providers?: string[]
}

export function routingEnabled(): boolean {
    return (process.env.DINGHY_MODEL_ROUTING ?? 'on').toLowerCase() !== 'off'
}

function providers(): string[] {
    const raw = process.env.DINGHY_PROVIDERS ?? 'hopscotch'
    return raw.split(',').map((s) => s.trim()).filter(Boolean)
}

/** Routing prefs for Dinghy's gateway calls, or undefined when routing is off (pinned model). */
export function routingFor(): RoutingPrefs | undefined {
    if (!routingEnabled()) return undefined
    return { providers: providers() }
}

/** Request model + body extension for a gateway call. */
export function modelFields(pinned: string, routing: RoutingPrefs | undefined): { model: string; shipyard?: RoutingPrefs } {
    return routing ? { model: 'auto', shipyard: routing } : { model: pinned }
}
