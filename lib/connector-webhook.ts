/**
 * Dock -> Dinghy webhook sender. Server only. No internal imports, so node:test can load this file directly.
 *
 * Signing: HMAC-SHA256 hex over `${timestamp}.${rawBody}` with the shared secret, sent as
 *   x-dinghy-timestamp: <unix seconds>
 *   x-dinghy-signature: <hex>
 * Dinghy's receiver (src/lib/dock/hmac.ts, verifyDockSignature) checks a 300-second window and dedupes by event_id.
 *
 * Fail closed: with no secret configured, nothing is sent and the outcome is 'no_secret'. Never send unsigned.
 */
import { createHmac, randomUUID } from "crypto"

// www is canonical: the apex 308-redirects to www, and the sender refuses redirects (fail closed).
export const DINGHY_DEFAULT_WEBHOOK_URL = "https://www.getdinghy.sh/api/dock/webhook"
const SEND_TIMEOUT_MS = 8_000

export type ConnectorEventType = "approval.requested" | "approval.closed" | "run.update" | "chief.renamed" | "link.revoked"

export type WebhookOutcome = "sent" | "no_secret" | "bad_url" | "failed"

/** HMAC-SHA256 over `${timestamp}.${rawBody}`, hex. Must match Dinghy's signDockPayload. */
export function signConnectorPayload(secret: string, timestampSeconds: number, rawBody: string): string {
  return createHmac("sha256", secret).update(`${timestampSeconds}.${rawBody}`).digest("hex")
}

/** Keeps a run's text short enough for a chat message. Dinghy truncates at 900 too. */
export function clipRunText(text: string, max = 900): string {
  const t = text.trim()
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`
}

/** Accepts https only (localhost excepted for dev). */
export function webhookUrlAllowed(raw: string): boolean {
  try {
    const u = new URL(raw)
    if (u.protocol === "https:") return true
    return u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1")
  } catch {
    return false
  }
}

export interface SendInput {
  secret: string | undefined
  url: string | undefined
  linkRef: string
  workspaceId: string
  type: ConnectorEventType
  data: Record<string, unknown>
  nowSeconds?: number
  fetchImpl?: typeof fetch
  eventId?: string
}

/** Signs and posts one event. Returns an outcome; never throws, so a failed webhook cannot break a run. */
export async function sendConnectorEvent(input: SendInput): Promise<WebhookOutcome> {
  const secret = (input.secret ?? "").trim()
  if (!secret) return "no_secret"
  const url = (input.url ?? "").trim() || DINGHY_DEFAULT_WEBHOOK_URL
  if (!webhookUrlAllowed(url)) return "bad_url"

  const body = JSON.stringify({
    event_id: input.eventId ?? randomUUID(),
    type: input.type,
    link_ref: input.linkRef,
    workspace_id: input.workspaceId,
    data: input.data,
  })
  const ts = input.nowSeconds ?? Math.floor(Date.now() / 1000)
  const signature = signConnectorPayload(secret, ts, body)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS)
  try {
    const res = await (input.fetchImpl ?? fetch)(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-dinghy-timestamp": String(ts),
        "x-dinghy-signature": signature,
      },
      body,
      signal: controller.signal,
      redirect: "error",
    })
    if (!res.ok) {
      // Status only. The response body is not logged.
      console.error(`connector webhook ${input.type} rejected: HTTP ${res.status}`)
      return "failed"
    }
    return "sent"
  } catch {
    console.error(`connector webhook ${input.type} failed: network`)
    return "failed"
  } finally {
    clearTimeout(timer)
  }
}
