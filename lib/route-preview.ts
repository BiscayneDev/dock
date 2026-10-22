/**
 * Shipyard Inference route preview client (POST /v1/route).
 *
 * Server-side only: call it from the worker and API routes, never from client components. The file has no
 * `server-only` import so node:test can load it. It asks the gateway which model Jev would pick and what that
 * call would cost. The preview never calls a model and never records spend, so it is informational: the approval
 * gate does not depend on it.
 *
 * Rules:
 * - No key (SHIPYARD_ROUTE_KEY unset or blank) returns { ok:false, reason:'not_configured' } with no network call.
 *   There is no unauthenticated fallback.
 * - Every failure is a typed reason. Nothing throws to the caller, and the key never appears in a result or log.
 */

export const DEFAULT_ROUTE_URL = "https://shipyard-inference.vercel.app/v1/route"
export const ROUTE_PREVIEW_TIMEOUT_MS = 5000
/** The model value that lets the gateway's Jev choose. Runs default to this. */
export const SHIPYARD_AUTO_MODEL = "shipyard/auto"

export type RouteReason =
  | "not_configured"
  | "timeout"
  | "network_error"
  | "unauthorized"
  | "bad_request"
  | "no_capable_model"
  | "rate_limited"
  | "http_error"
  | "bad_response"
  | "model_chosen"
  | "preview_error"

/** The route fields stored on approval events. Matches what the approval card reads. */
export interface RouteDecision {
  model: string
  provider: string
  tier: string | null
  estimatedCostUsd: number | null
  estimateBasis: string
  routeId: string
  jevConfidence: number | null
}

export type RoutePreviewResult =
  | { ok: true; route: RouteDecision; previewedAt: string }
  | { ok: false; reason: RouteReason }

export interface RouteMessage {
  role: "system" | "user" | "assistant"
  content: string
}

export interface RoutePreviewOptions {
  env?: Record<string, string | undefined>
  fetchImpl?: typeof fetch
  timeoutMs?: number
  now?: () => Date
}

type Obj = Record<string, unknown>

function isObj(v: unknown): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v)
}

function nonEmptyString(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v : null
}

function finiteOrNull(v: unknown): number | null | undefined {
  if (v === null) return null
  if (typeof v === "number" && Number.isFinite(v)) return v
  return undefined
}

/**
 * Validates the gateway's JSON body. Returns null for anything malformed: a missing or wrong-typed required
 * field, or a non-finite number. Optional-looking fields that are present must still have the right type.
 */
export function parseRouteResponse(json: unknown): RouteDecision | null {
  if (!isObj(json)) return null
  const model = nonEmptyString(json.model)
  const provider = nonEmptyString(json.provider)
  const routeId = nonEmptyString(json.route_id)
  if (!model || !provider || !routeId) return null
  if (typeof json.estimate_basis !== "string") return null

  const cost = finiteOrNull(json.estimated_cost_usd)
  if (cost === undefined) return null

  let tier: string | null = null
  if (json.tier !== null && json.tier !== undefined) {
    if (typeof json.tier !== "string") return null
    tier = json.tier
  }

  const confidence = json.jev_confidence === undefined ? null : finiteOrNull(json.jev_confidence)
  if (confidence === undefined) return null

  return {
    model,
    provider,
    tier,
    estimatedCostUsd: cost,
    estimateBasis: json.estimate_basis.slice(0, 1000),
    routeId,
    jevConfidence: confidence,
  }
}

function reasonForStatus(status: number): RouteReason {
  if (status === 400) return "bad_request"
  if (status === 401) return "unauthorized"
  if (status === 422) return "no_capable_model"
  if (status === 429) return "rate_limited"
  return "http_error"
}

/**
 * Asks the gateway for the route Jev would pick for these messages. Resolves in at most `timeoutMs` (5s by
 * default), whether or not the fetch honours the abort signal.
 */
export async function previewRoute(
  messages: RouteMessage[],
  opts: RoutePreviewOptions = {},
): Promise<RoutePreviewResult> {
  const env = opts.env ?? process.env
  const key = env.SHIPYARD_ROUTE_KEY?.trim()
  if (!key) return { ok: false, reason: "not_configured" }

  const url = env.SHIPYARD_ROUTE_URL?.trim() || DEFAULT_ROUTE_URL
  const fetchImpl = opts.fetchImpl ?? fetch
  const timeoutMs = opts.timeoutMs ?? ROUTE_PREVIEW_TIMEOUT_MS
  const now = opts.now ?? (() => new Date())
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined

  const work = async (): Promise<RoutePreviewResult> => {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({ model: "auto", messages }),
      signal: controller.signal,
      cache: "no-store",
    })
    if (!res.ok) return { ok: false, reason: reasonForStatus(res.status) }
    let json: unknown
    try {
      json = await res.json()
    } catch {
      return { ok: false, reason: "bad_response" }
    }
    const route = parseRouteResponse(json)
    if (!route) return { ok: false, reason: "bad_response" }
    return { ok: true, route, previewedAt: now().toISOString() }
  }

  const timedOut = new Promise<RoutePreviewResult>((resolve) => {
    timer = setTimeout(() => {
      controller.abort()
      resolve({ ok: false, reason: "timeout" })
    }, timeoutMs)
  })

  try {
    return await Promise.race([
      work().catch((): RoutePreviewResult => ({ ok: false, reason: controller.signal.aborted ? "timeout" : "network_error" })),
      timedOut,
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/**
 * The `route` and `routeReason` values stored on an approval_requested event. Exactly one is non-null, so the
 * card can show either the route or the reason it is missing.
 */
export function approvalRouteFields(
  result: RoutePreviewResult,
): { route: (RouteDecision & { previewedAt: string }) | null; routeReason: RouteReason | null } {
  if (!result.ok) return { route: null, routeReason: result.reason }
  const r = result.route
  return {
    route: {
      model: r.model,
      provider: r.provider,
      tier: r.tier,
      estimatedCostUsd: r.estimatedCostUsd,
      estimateBasis: r.estimateBasis,
      routeId: r.routeId,
      jevConfidence: r.jevConfidence,
      previewedAt: result.previewedAt,
    },
    routeReason: null,
  }
}
