/**
 * Shipyard per-call capture (telemetry only).
 *
 * The AI SDK's OpenAI client ignores unknown fields, so the gateway's
 * `x_shipyard` stream frame and `x-shipyard-*` response headers never reach
 * the SDK result. This module wraps the fetch passed to the Shipyard provider:
 * it passes the response bytes through unchanged and scans SSE `data:` lines
 * for `x_shipyard`, recording costUsd/model/provider/billed/outcome per HTTP
 * call. Every failure here is swallowed: telemetry must never break a reply.
 *
 * Only numbers and model/provider names are recorded. Prompts, completions
 * and keys never enter this structure.
 */

export interface ShipyardCallRecord {
  startedAt: string
  endedAt: string | null
  httpStatus: number | null
  model: string | null
  provider: string | null
  costUsd: number | null
  billed: boolean | null
  outcome: string | null
}

export interface ShipyardCapture {
  calls: ShipyardCallRecord[]
}

export function createShipyardCapture(): ShipyardCapture {
  return { calls: [] }
}

function finiteOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function headerCost(res: Response): number | null {
  const raw = res.headers.get("x-shipyard-cost-usd")
  if (raw === null || raw.trim() === "") return null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

function applyFrame(record: ShipyardCallRecord, frame: unknown): void {
  if (!frame || typeof frame !== "object") return
  const xs = (frame as { x_shipyard?: unknown }).x_shipyard
  if (!xs || typeof xs !== "object") return
  const fields = xs as Record<string, unknown>
  // Last frame seen wins; only overwrite fields the frame actually carries.
  if ("costUsd" in fields) record.costUsd = finiteOrNull(fields.costUsd)
  if (typeof fields.model === "string") record.model = fields.model
  if (typeof fields.provider === "string") record.provider = fields.provider
  if (typeof fields.billed === "boolean") record.billed = fields.billed
  if (typeof fields.outcome === "string") record.outcome = fields.outcome
}

/**
 * Pass-through tap. Enqueues every chunk untouched before inspecting it.
 * When `scanSse` is set, complete `data:` lines containing `x_shipyard` are
 * parsed. On flush (end of body) the call is stamped with endedAt.
 */
function tap(record: ShipyardCallRecord, scanSse: boolean): TransformStream<Uint8Array, Uint8Array> {
  const decoder = new TextDecoder()
  let buffer = ""

  const scanLine = (raw: string) => {
    const line = raw.trim()
    if (!line.startsWith("data:") || !line.includes("x_shipyard")) return
    try {
      applyFrame(record, JSON.parse(line.slice(5)))
    } catch {
      // Unparseable telemetry frame: ignore.
    }
  }

  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      controller.enqueue(chunk)
      if (!scanSse) return
      try {
        buffer += decoder.decode(chunk, { stream: true })
        let newline = buffer.indexOf("\n")
        while (newline !== -1) {
          scanLine(buffer.slice(0, newline))
          buffer = buffer.slice(newline + 1)
          newline = buffer.indexOf("\n")
        }
      } catch {
        buffer = ""
      }
    },
    flush() {
      record.endedAt = new Date().toISOString()
      if (!scanSse) return
      try {
        buffer += decoder.decode()
        if (buffer) scanLine(buffer)
      } catch {
        // ignore
      }
      buffer = ""
    },
  })
}

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

/**
 * A fetch that behaves like the global fetch for every URL, and additionally
 * records a ShipyardCallRecord for each request under `baseUrl`.
 */
export function createCapturingFetch(baseUrl: string, capture: ShipyardCapture): FetchLike {
  const prefix = baseUrl.replace(/\/+$/, "")
  return async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
    if (!url.startsWith(prefix)) return fetch(input, init)

    const record: ShipyardCallRecord = {
      startedAt: new Date().toISOString(),
      endedAt: null,
      httpStatus: null,
      model: null,
      provider: null,
      costUsd: null,
      billed: null,
      outcome: null,
    }
    capture.calls.push(record)

    const res = await fetch(input, init)
    try {
      record.httpStatus = res.status
      record.model = res.headers.get("x-shipyard-model")
      record.provider = res.headers.get("x-shipyard-provider")
      record.costUsd = headerCost(res)
    } catch {
      // ignore header read errors
    }

    if (!res.body) {
      record.endedAt = new Date().toISOString()
      return res
    }

    const isSse = (res.headers.get("content-type") ?? "").includes("text/event-stream")
    try {
      const body = res.body.pipeThrough(tap(record, isSse))
      return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers })
    } catch {
      // If wrapping fails, return the original response untouched.
      record.endedAt = new Date().toISOString()
      return res
    }
  }
}
