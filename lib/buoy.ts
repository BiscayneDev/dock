/**
 * Buoy (ship-credits) client — Dock is a Buoy "platform" embed.
 *
 * Env:
 *   BUOY_CREDITS_URL    base URL of the buoy-credits HTTP API (e.g. http://localhost:8787)
 *   BUOY_CREDITS_API_KEY  operator or platform-scoped API key
 *   BUOY_PLATFORM_ID    platform id (must match the key's scope)
 *
 * All amounts are micro-USD integers (1_000_000 = $1). When the env is unset
 * the client returns null and callers degrade gracefully — the brief simply
 * carries no quote.
 */

export interface QuoteStep {
  name: string
  serviceId: string
  amountUsd: number
}

export interface BriefQuote {
  quoteId: string
  totalUsd: number
  steps: QuoteStep[]
  createdAt: string
  expiresAt: string
}

export interface DiscoveredService {
  serviceId: string
  name: string
  outcome: string
  category: string
  pricePerCallUsd: number
  rating: number
  score: number
  /** Ready to drop into a quote's `steps`. */
  step: { name: string; serviceId: string; amountUsd: number }
}

export interface BuoyJob {
  jobId: string
  quoteId: string
  approvedTotal: number
  rail: "shipusd" | "usdc"
  status: string
  createdAt: string
}

function buoyConfig() {
  const url = process.env.BUOY_CREDITS_URL
  const apiKey = process.env.BUOY_CREDITS_API_KEY
  const platformId = process.env.BUOY_PLATFORM_ID
  if (!url || !apiKey || !platformId) return null
  return { url: url.replace(/\/$/, ""), apiKey, platformId }
}

export function buoyConfigured(): boolean {
  return buoyConfig() !== null
}

async function buoyFetch<T>(
  path: string,
  init?: RequestInit & { body?: string }
): Promise<T | null> {
  const cfg = buoyConfig()
  if (!cfg) return null
  try {
    const res = await fetch(`${cfg.url}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cfg.apiKey}`,
        ...(init?.headers ?? {}),
      },
    })
    if (!res.ok) {
      console.error(`[buoy] ${path} -> ${res.status}`, await res.text().catch(() => "").then((t) => t.slice(0, 300)))
      return null
    }
    return (await res.json()) as T
  } catch {
    return null
  }
}

/** Free intent search over the Buoy catalog. */
export async function discoverServices(
  query: string,
  maxResults = 3
): Promise<DiscoveredService[]> {
  const out = await buoyFetch<{ candidates: DiscoveredService[] }>(
    "/v1/discover",
    { method: "POST", body: JSON.stringify({ query, maxResults }) }
  )
  return out?.candidates ?? []
}

/** Create an immutable platform-scoped quote. Total must equal the sum of steps. */
export async function createQuote(
  steps: QuoteStep[],
  userId = "briefs"
): Promise<BriefQuote | null> {
  const cfg = buoyConfig()
  if (!cfg) return null
  const totalUsd = steps.reduce((sum, s) => sum + s.amountUsd, 0)
  const out = await buoyFetch<{ quote: BriefQuote }>(
    `/v1/platform/${cfg.platformId}/quotes`,
    { method: "POST", body: JSON.stringify({ userId, totalUsd, steps }) }
  )
  return out?.quote ?? null
}

/** Create a durable job from an approved quote. Idempotency key must be
 * prefixed `plat-{pid}-`; we derive it deterministically from the task id. */
export async function createJob(
  quote: BriefQuote,
  rail: "shipusd" | "usdc",
  taskId: string,
  userId = "briefs"
): Promise<BuoyJob | null> {
  const cfg = buoyConfig()
  if (!cfg) return null
  const idempotencyKey = `plat-${cfg.platformId}-task-${taskId}`
  const out = await buoyFetch<{ job: BuoyJob }>(
    `/v1/platform/${cfg.platformId}/jobs`,
    {
      method: "POST",
      body: JSON.stringify({
        userId,
        quoteId: quote.quoteId,
        approvedTotal: quote.totalUsd,
        rail,
        idempotencyKey,
      }),
    }
  )
  return out?.job ?? null
}

export async function getJob(jobId: string): Promise<BuoyJob | null> {
  const cfg = buoyConfig()
  if (!cfg) return null
  const out = await buoyFetch<{ job: BuoyJob }>(
    `/v1/platform/${cfg.platformId}/jobs/${encodeURIComponent(jobId)}`
  )
  return out?.job ?? null
}
