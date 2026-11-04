import http from "node:http"
import { unlink } from "node:fs/promises"

// Bounded broker: the ONLY network path a confined task container gets.
//
// Containers run with --network none, so the agent inside cannot reach the
// model API, secrets, or arbitrary hosts. The broker listens on a unix socket
// placed INSIDE the task worktree (which is the one mount the container has),
// and forwards exactly one route - POST /infer - to Dock's infer endpoint,
// injecting the device token itself. The token never enters the container;
// the container can never reach anything but this one route.

export const BROKER_SOCKET_NAME = ".dock-broker.sock"

export function brokerSocketPath(worktreePath) {
  return `${worktreePath.replace(/\/+$/, "")}/${BROKER_SOCKET_NAME}`
}

export const BROKER_MAX_BODY_BYTES = 64 * 1024
export const BROKER_MAX_CONCURRENT = 4
export const BROKER_UPSTREAM_TIMEOUT_MS = 30_000

/**
 * One broker per authorized run: it is bound to that run's id, so the container
 * cannot spend against any other run. Request bodies are byte-capped, concurrent
 * upstream calls are capped, and upstream calls time out.
 *
 * @param {object} opts
 * @param {string} opts.socketPath unix socket to listen on
 * @param {string} opts.upstreamInferUrl full URL of Dock's infer endpoint
 * @param {string} opts.deviceToken injected upstream; never sent to the container
 * @param {string} opts.runId the single authorized run id
 * @param {number} [opts.maxBodyBytes]
 * @param {number} [opts.maxConcurrent]
 * @param {number} [opts.upstreamTimeoutMs]
 * @param {typeof fetch} [opts.fetchImpl]
 */
export async function startBroker({
  socketPath,
  upstreamInferUrl,
  deviceToken,
  runId,
  maxBodyBytes = BROKER_MAX_BODY_BYTES,
  maxConcurrent = BROKER_MAX_CONCURRENT,
  upstreamTimeoutMs = BROKER_UPSTREAM_TIMEOUT_MS,
  fetchImpl = fetch,
}) {
  if (!socketPath || !upstreamInferUrl || !deviceToken || !runId) throw new Error("socketPath, upstreamInferUrl, deviceToken and runId required")
  await unlink(socketPath).catch(() => {})
  let inFlight = 0
  const server = http.createServer((req, res) => {
    if (req.method !== "POST" || req.url !== "/infer") {
      res.writeHead(404, { "content-type": "application/json" })
      res.end(JSON.stringify({ error: "broker only serves POST /infer" }))
      return
    }
    if (inFlight >= maxConcurrent) {
      res.writeHead(429, { "content-type": "application/json" })
      res.end(JSON.stringify({ error: "broker concurrency cap" }))
      return
    }
    const chunks = []
    let bytes = 0
    let tooBig = false
    req.on("data", (c) => {
      bytes += c.length
      if (bytes > maxBodyBytes) {
        tooBig = true
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on("end", async () => {
      if (tooBig) return
      // Body must be JSON naming the bound run - no arbitrary run ids, ever.
      let parsed
      try {
        parsed = JSON.parse(Buffer.concat(chunks).toString())
      } catch {
        res.writeHead(400, { "content-type": "application/json" })
        res.end(JSON.stringify({ error: "body must be JSON" }))
        return
      }
      if (parsed?.runId !== runId) {
        res.writeHead(403, { "content-type": "application/json" })
        res.end(JSON.stringify({ error: "broker is bound to a different run" }))
        return
      }
      inFlight += 1
      try {
        const upstream = await fetchImpl(upstreamInferUrl, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${deviceToken}` },
          body: Buffer.concat(chunks),
          signal: AbortSignal.timeout(upstreamTimeoutMs),
        })
        const text = await upstream.text()
        res.writeHead(upstream.status, { "content-type": "application/json" })
        res.end(text)
      } catch {
        res.writeHead(502, { "content-type": "application/json" })
        res.end(JSON.stringify({ error: "upstream unreachable" }))
      } finally {
        inFlight -= 1
      }
    })
  })
  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen)
    server.listen(socketPath, resolveListen)
  })
  return {
    socketPath,
    close: () => new Promise((done) => server.close(() => unlink(socketPath).catch(() => {}).finally(done))),
  }
}
