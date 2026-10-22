import { ApiError } from "./api.mjs"

// Claim loop. Heartbeats on a timer (every 30s, also while a run executes), claims when idle, backs off on errors.
// A 401 on any call means the device token is no longer valid: the loop stops and reports 'revoked'.

export const BACKOFF_BASE_MS = 1_000
export const BACKOFF_CAP_MS = 60_000
export const IDLE_POLL_MS = 5_000

export function backoffMs(failures) {
  const n = Math.max(1, Math.floor(failures))
  return Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** (n - 1))
}

export function sleep(ms, signal) {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve()
    const timer = setTimeout(done, ms)
    function done() {
      clearTimeout(timer)
      signal?.removeEventListener?.("abort", done)
      resolve()
    }
    signal?.addEventListener?.("abort", done, { once: true })
  })
}

/**
 * @returns {Promise<{stopped: 'signal' | 'revoked', runs: number}>}
 */
export async function runLoop({
  api,
  executeRun,
  localTools = null,
  signal,
  log = () => {},
  heartbeatMs = 30_000,
  pollMs = IDLE_POLL_MS,
  waitFn = sleep,
}) {
  let stopReason = null
  let runs = 0
  let failures = 0
  const stop = (reason) => {
    if (!stopReason) stopReason = reason
  }

  const heartbeat = async () => {
    try {
      await api.heartbeat()
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        log("device token rejected (revoked or unpaired); stopping")
        stop("revoked")
      } else {
        log(`heartbeat failed: ${err.message}`)
      }
    }
  }
  await heartbeat()
  const timer = setInterval(heartbeat, heartbeatMs)
  timer.unref?.()

  try {
    while (!signal?.aborted && !stopReason) {
      try {
        const run = await api.claim()
        failures = 0
        if (!run) {
          await waitFn(pollMs, signal)
          continue
        }
        log(`claimed run ${run.id}`)
        const result = await executeRun(run, { api, localTools, log })
        runs += 1
        log(`run ${run.id}: ${result.outcome}`)
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          log("device token rejected (revoked or unpaired); stopping")
          stop("revoked")
          break
        }
        failures += 1
        const wait = backoffMs(failures)
        log(`error: ${err.message}; retrying in ${Math.round(wait / 1000)}s`)
        await waitFn(wait, signal)
      }
    }
  } finally {
    clearInterval(timer)
  }
  return { stopped: stopReason ?? "signal", runs }
}
