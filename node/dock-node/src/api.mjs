// HTTP client for Dock's device endpoints. Every call except pairing sends the device token as a bearer.
// A 401 means the token is gone (revoked or never paired); callers stop on it instead of retrying.

export class ApiError extends Error {
  constructor(status, message) {
    super(message)
    this.name = "ApiError"
    this.status = status
  }
}

export function createApi({ server, token, fetchImpl = fetch, timeoutMs = 180_000 }) {
  const base = server.replace(/\/+$/, "")

  async function call(method, path, body) {
    const res = await fetchImpl(`${base}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new ApiError(res.status, typeof data.error === "string" ? data.error : res.statusText)
    return data
  }

  return {
    heartbeat: () => call("POST", "/api/devices/heartbeat"),
    claim: async () => (await call("POST", "/api/devices/claim")).run ?? null,
    event: (runId, kind, data = {}) => call("POST", `/api/runs/${encodeURIComponent(runId)}/events`, { kind, data }),
    complete: (runId, body) => call("POST", `/api/runs/${encodeURIComponent(runId)}/complete`, body),
    infer: (runId) => call("POST", "/api/devices/infer", { run_id: runId }),
  }
}

/** Exchanges a pairing code for a device token. No bearer: the code is the credential. */
export async function pairDevice({ server, code, name, fetchImpl = fetch }) {
  const base = server.replace(/\/+$/, "")
  const res = await fetchImpl(`${base}/api/devices/pair`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code, name }),
    signal: AbortSignal.timeout(30_000),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new ApiError(res.status, typeof data.error === "string" ? data.error : res.statusText)
  if (typeof data.deviceToken !== "string" || typeof data.deviceId !== "string") {
    throw new ApiError(502, "pairing response was malformed")
  }
  return { deviceId: data.deviceId, deviceToken: data.deviceToken }
}
