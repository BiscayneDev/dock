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

/**
 * @param {object} opts
 * @param {string} opts.socketPath unix socket to listen on
 * @param {string} opts.upstreamInferUrl full URL of Dock's infer endpoint
 * @param {string} opts.deviceToken injected upstream; never sent to the container
 * @param {typeof fetch} [opts.fetchImpl]
 */
export async function startBroker({ socketPath, upstreamInferUrl, deviceToken, fetchImpl = fetch }) {
  if (!socketPath || !upstreamInferUrl || !deviceToken) throw new Error("socketPath, upstreamInferUrl and deviceToken required")
  await unlink(socketPath).catch(() => {})
  const server = http.createServer((req, res) => {
    if (req.method !== "POST" || req.url !== "/infer") {
      res.writeHead(404, { "content-type": "application/json" })
      res.end(JSON.stringify({ error: "broker only serves POST /infer" }))
      return
    }
    const chunks = []
    req.on("data", (c) => chunks.push(c))
    req.on("end", async () => {
      try {
        const upstream = await fetchImpl(upstreamInferUrl, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${deviceToken}` },
          body: Buffer.concat(chunks),
        })
        const text = await upstream.text()
        res.writeHead(upstream.status, { "content-type": "application/json" })
        res.end(text)
      } catch {
        res.writeHead(502, { "content-type": "application/json" })
        res.end(JSON.stringify({ error: "upstream unreachable" }))
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
