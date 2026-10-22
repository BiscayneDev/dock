/**
 * Pure rules for approval previews: which targets may be captured, and which storage paths belong to whom.
 * No I/O and no `@/` imports, so node:test can load this file directly (test/preview-guard.test.mjs).
 * The screenshot is for the human approver to see. It never triggers, authorises or executes anything.
 */

export const PREVIEW_BUCKET = "approval-previews"
export const PREVIEW_VIEWPORT = { width: 1280, height: 800 } as const
export const PREVIEW_NAV_TIMEOUT_MS = 15_000
/** Signed URLs live 24 hours. The card regenerates through the preview route after that. */
export const PREVIEW_URL_TTL_SECONDS = 24 * 60 * 60

export type TargetCheck = { ok: true; url: URL } | { ok: false; reason: "invalid_url" | "scheme" | "private_address" }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Parses dotted IPv4 into four octets. Returns null for anything that is not a plain IPv4 literal. */
function ipv4Octets(host: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
  if (!m) return null
  const o = m.slice(1).map(Number)
  return o.every((n) => n >= 0 && n <= 255) ? o : null
}

/** True when an IPv4 address is loopback, private, link-local, unspecified or otherwise not public. */
export function isPrivateIPv4(o: number[]): boolean {
  const [a, b] = o
  if (a === 0) return true // 0.0.0.0/8
  if (a === 10) return true // 10/8
  if (a === 127) return true // 127/8 loopback
  if (a === 169 && b === 254) return true // link-local
  if (a === 172 && b >= 16 && b <= 31) return true // 172.16/12
  if (a === 192 && b === 168) return true // 192.168/16
  if (a === 100 && b >= 64 && b <= 127) return true // 100.64/10 carrier-grade NAT
  if (a >= 224) return true // multicast and reserved
  return false
}

/** True when an IPv6 literal is loopback, unspecified, link-local, unique-local, or an IPv4-mapped private address. */
export function isPrivateIPv6(raw: string): boolean {
  const h = raw.toLowerCase().replace(/^\[|\]$/g, "")
  if (h === "::" || h === "::1") return true
  if (/^fe[89ab][0-9a-f]?:/.test(h)) return true // fe80::/10 link-local
  if (/^f[cd][0-9a-f]{0,2}:/.test(h)) return true // fc00::/7 unique local
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(h)
  if (mapped) {
    const o = ipv4Octets(mapped[1])
    return o ? isPrivateIPv4(o) : true
  }
  if (h.startsWith("::ffff:")) return true // mapped in hex form: refuse
  return false
}

/** Refuses hosts that are, or name, a private or local address. Used for the URL and for every resolved IP. */
export function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "")
  if (host === "localhost" || host.endsWith(".localhost")) return true
  if (host.endsWith(".local") || host.endsWith(".internal")) return true
  if (host.includes(":")) return isPrivateIPv6(host)
  const o = ipv4Octets(host)
  if (o) return isPrivateIPv4(o)
  return false
}

/** Checks a raw target URL before any browser work. Only http(s) to public hosts passes. file: and friends are refused. */
export function checkTargetUrl(raw: unknown): TargetCheck {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 2048) return { ok: false, reason: "invalid_url" }
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return { ok: false, reason: "invalid_url" }
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return { ok: false, reason: "scheme" }
  if (url.username || url.password) return { ok: false, reason: "invalid_url" }
  if (isPrivateHost(url.hostname)) return { ok: false, reason: "private_address" }
  return { ok: true, url }
}

/** Owner-scoped object path: <owner_id>/<run_id>/<timestamp>.png. Refuses anything that is not two UUIDs and a digit stamp. */
export function previewObjectPath(ownerId: string, runId: string, stampMs: number): string {
  if (!UUID.test(ownerId) || !UUID.test(runId)) throw new Error("preview path needs uuid owner and run")
  if (!Number.isSafeInteger(stampMs) || stampMs <= 0) throw new Error("preview path needs a timestamp")
  return `${ownerId.toLowerCase()}/${runId.toLowerCase()}/${stampMs}.png`
}

/** A stored path is usable only if it sits under the owner's folder for this run and has the expected shape. */
export function isOwnedPreviewPath(path: unknown, ownerId: string, runId: string): path is string {
  if (typeof path !== "string" || !UUID.test(ownerId) || !UUID.test(runId)) return false
  const re = new RegExp(`^${ownerId.toLowerCase()}/${runId.toLowerCase()}/\\d+\\.png$`)
  return re.test(path)
}

export interface PreviewRunRef {
  id: string
  ownerId: string
}

/**
 * Decides whether a caller may get a fresh signed URL for a run's preview. Owner only.
 * `storedPath` comes from the approval_requested event; the path must belong to the owner and this run.
 */
export function previewAccess(
  run: PreviewRunRef | null,
  userId: string | null | undefined,
  storedPath: unknown,
): { ok: true; path: string } | { ok: false; reason: "not_found" | "forbidden" | "no_preview" } {
  if (!run || !userId) return { ok: false, reason: "not_found" }
  if (run.ownerId.toLowerCase() !== userId.toLowerCase()) return { ok: false, reason: "forbidden" }
  if (!isOwnedPreviewPath(storedPath, run.ownerId, run.id)) return { ok: false, reason: "no_preview" }
  return { ok: true, path: storedPath }
}

/** Reasons shown on the card as 'No preview yet (reason)'. Plain words, no internals. */
export const PREVIEW_REASON_LABEL: Record<string, string> = {
  no_target: "no page to show",
  refused_target: "address not allowed",
  capture_timeout: "page took too long",
  capture_failed: "capture failed",
  capture_unavailable: "browser unavailable",
  upload_failed: "could not save",
}

export function previewReasonLabel(reason: unknown): string | null {
  if (typeof reason !== "string") return null
  return PREVIEW_REASON_LABEL[reason] ?? "capture failed"
}

/** The page to capture for an approval: an explicit previewUrl on the run, else the action's destination when it is a URL. */
export function previewTargetFromRun(payload: Record<string, unknown>, destination: string | undefined): unknown {
  if (typeof payload.previewUrl === "string" && payload.previewUrl.length > 0) return payload.previewUrl
  if (typeof destination === "string" && /^https?:\/\//i.test(destination)) return destination
  return null
}

export type PreviewOutcome =
  | { ok: true; screenshotUrl: string; screenshotPath: string; screenshotExpiresAt: string }
  | { ok: false; reason: string }

export interface PreviewDeps {
  /** Renders the URL to PNG bytes. Must enforce the SSRF guard itself on every request it makes. */
  capture: (url: URL) => Promise<{ ok: true; png: Uint8Array } | { ok: false; reason: "capture_failed" | "capture_timeout" | "capture_unavailable" }>
  /** Writes the PNG to the private bucket at `path`. */
  store: (path: string, png: Uint8Array) => Promise<boolean>
  /** Signs a read URL for `path`, valid for `ttlSeconds`. Null on failure. */
  sign: (path: string, ttlSeconds: number) => Promise<string | null>
  now: () => number
}

/**
 * Captures one screenshot for an approval request, never longer than `budgetMs`. Never throws.
 * Any failure returns { ok: false, reason } and the caller creates the approval with no screenshot.
 * The screenshot is shown to the approver only. It does not authorise or trigger the action.
 */
export async function capturePreviewForApproval(
  input: { ownerId: string; runId: string; target: unknown },
  deps: PreviewDeps,
  budgetMs: number = PREVIEW_NAV_TIMEOUT_MS,
): Promise<PreviewOutcome> {
  try {
    if (input.target === null || input.target === undefined || input.target === "") return { ok: false, reason: "no_target" }
    const check = checkTargetUrl(input.target)
    if (!check.ok) return { ok: false, reason: "refused_target" }

    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<{ ok: false; reason: "capture_timeout" }>((resolve) => {
      timer = setTimeout(() => resolve({ ok: false, reason: "capture_timeout" }), budgetMs)
    })
    let shot: Awaited<ReturnType<PreviewDeps["capture"]>>
    try {
      shot = await Promise.race([deps.capture(check.url), timeout])
    } finally {
      if (timer) clearTimeout(timer)
    }
    if (!shot.ok) return { ok: false, reason: shot.reason }

    const stamp = deps.now()
    const path = previewObjectPath(input.ownerId, input.runId, stamp)
    if (!(await deps.store(path, shot.png))) return { ok: false, reason: "upload_failed" }
    const url = await deps.sign(path, PREVIEW_URL_TTL_SECONDS)
    if (!url || !/^https:\/\//.test(url)) return { ok: false, reason: "upload_failed" }
    return {
      ok: true,
      screenshotUrl: url,
      screenshotPath: path,
      screenshotExpiresAt: new Date(stamp + PREVIEW_URL_TTL_SECONDS * 1000).toISOString(),
    }
  } catch {
    return { ok: false, reason: "capture_failed" }
  }
}
