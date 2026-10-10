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
    /** Requires gateway attempt-timeout support; preserves Jev quality floor. */
    attempt_timeout_ms?: number
    max_tier?: 'economy'
}

export function routingEnabled(): boolean {
    return (process.env.DINGHY_MODEL_ROUTING ?? 'on').toLowerCase() !== 'off'
}

export function providers(): string[] {
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
    return routing ? { model: 'auto', shipyard: { ...routing, attempt_timeout_ms: 15_000, max_tier: 'economy' } } : { model: pinned }
}

/**
 * Private route for Gmail/Calendar-derived content (Google API Limited Use).
 * Dinghy pins only the PROVIDER allowlist; the model stays Shipyard's call.
 *
 * DINGHY_PRIVATE_ROUTE=on enforces it (default off, so nothing changes until
 * Shipyard serves a private provider). DINGHY_PRIVATE_PROVIDERS is the
 * comma-separated allowlist of providers with a contractual no-train, no-retain
 * route. There is deliberately NO default: unset means unavailable, and an
 * enforced call then fails closed instead of falling back to the normal route.
 */
export class PrivateRouteUnavailable extends Error {
    constructor() {
        super('private route unavailable: DINGHY_PRIVATE_PROVIDERS is empty')
        this.name = 'PrivateRouteUnavailable'
    }
}

export function privateRouteEnforced(): boolean {
    return (process.env.DINGHY_PRIVATE_ROUTE ?? 'off').toLowerCase() === 'on'
}

/** shadow: count tainted turns that WOULD go private, change nothing. Use it to size the UX and cost impact first. */
export function privateRouteShadow(): boolean {
    return (process.env.DINGHY_PRIVATE_ROUTE ?? 'off').toLowerCase() === 'shadow'
}

export function privateProviders(): string[] {
    return (process.env.DINGHY_PRIVATE_PROVIDERS ?? '').split(',').map((s) => s.trim()).filter(Boolean)
}

/** Routing prefs for a call that carries Google data. Throws (fail closed) when enforced and no private provider is set. */
export function privateRouting(): RoutingPrefs {
    const p = privateProviders()
    if (p.length === 0) throw new PrivateRouteUnavailable()
    return { providers: p }
}

/**
 * Body extension for any gateway call that can carry Google user data, pinned
 * model or not. Enforced: model auto on the private allowlist only. Not
 * enforced: the normal provider allowlist (no change in provider, but the
 * restriction now applies to calls that used to send none).
 */
export function googleSafeBody(): { model?: string; shipyard: RoutingPrefs } {
    if (privateRouteEnforced()) return { model: 'auto', shipyard: privateRouting() }
    return { shipyard: { providers: providers() } }
}

/** Tools whose results are Gmail/Calendar data, or that can run them (workflows, recipes). */
export function isGoogleTool(name: string): boolean {
    return /^(gmail_|gcal_)/.test(name) || name === 'workflow_run' || name === 'recipe_run'
}
