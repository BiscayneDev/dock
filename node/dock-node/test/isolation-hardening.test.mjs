// Hardening: canonical path association, symlink denial, image validation,
// no host mounts, broker behavior. Run: node --test node/dock-node/test/isolation-hardening.test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import http from "node:http"
import { mkdtemp, mkdir, realpath, rm, symlink } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { isTaskWorktreePath, resolveTaskWorktree, isValidImageRef, containerRunArgs } from "../src/isolation.mjs"
import { startBroker, brokerSocketPath } from "../src/broker.mjs"

const TASK = "task-abc123"

async function setup(t) {
  const dir = await mkdtemp(join(tmpdir(), "dock-cont-"))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const repo = join(dir, "shipyard")
  const wt = join(dir, ".dock-worktrees", "shipyard", TASK)
  await mkdir(repo, { recursive: true })
  await mkdir(wt, { recursive: true })
  return { dir, repo: await realpath(repo), wt: await realpath(wt) }
}

test("resolveTaskWorktree accepts the canonical path of a registered repo's task", async (t) => {
  const { repo, wt } = await setup(t)
  const out = await resolveTaskWorktree(wt, [repo], TASK)
  assert.equal(out.resolved, wt)
  assert.equal(out.repo, repo)
})

test("resolveTaskWorktree refuses unregistered repo, wrong task, symlink decoys", async (t) => {
  const { dir, repo, wt } = await setup(t)
  await assert.rejects(() => resolveTaskWorktree(wt, [join(dir, "other-repo")], TASK), /not a task worktree of a registered repo/)
  await assert.rejects(() => resolveTaskWorktree(wt, [repo], "task-other"), /not a task worktree of a registered repo/)
  await assert.rejects(() => resolveTaskWorktree(wt, [repo], "../x"), /invalid task ref/)
  // a symlink elsewhere pointing at the real worktree still resolves to the canonical path (accepted)
  const link = join(dir, "decoy")
  await symlink(wt, link)
  const out = await resolveTaskWorktree(link, [repo], TASK)
  assert.equal(out.resolved, wt)
  // but a symlink INSIDE the tree shape pointing OUT is refused: swap repo dir name
  const evil = join(dir, ".dock-worktrees", "shipyard", "task-evil")
  await symlink("/etc", evil)
  await assert.rejects(() => resolveTaskWorktree(evil, [repo], "task-evil"), /not a task worktree/)
})

test("image refs validated; argv never carries host mounts or the docker socket", () => {
  assert.equal(isValidImageRef("node:22-alpine"), true)
  assert.equal(isValidImageRef("ghcr.io/org/img@sha256:abc"), true)
  assert.equal(isValidImageRef("bad image"), false)
  assert.equal(isValidImageRef("../escape"), false)
  assert.equal(isValidImageRef(""), false)
  assert.throws(() => containerRunArgs({ runtime: "docker", worktreePath: "/x/.dock-worktrees/r/task-a1", command: ["ls"], image: "bad image" }), /invalid image ref/)
  const argv = containerRunArgs({ runtime: "docker", worktreePath: "/x/.dock-worktrees/r/task-a1", command: ["ls"] })
  assert.ok(!argv.some((a) => a.includes("docker.sock")), argv.join(" "))
  const mountIndex = argv.indexOf("-v")
  assert.equal(argv.filter((a) => a === "-v").length, 1, "exactly one mount")
  assert.equal(argv[mountIndex + 1], "/x/.dock-worktrees/r/task-a1:/work", "the one mount is the task worktree only")
})

test("broker forwards only POST /infer and injects the token itself", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "dock-broker-"))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const seen = []
  const upstream = http.createServer((req, res) => {
    const chunks = []
    req.on("data", (c) => chunks.push(c))
    req.on("end", () => {
      seen.push({ url: req.url, auth: req.headers.authorization, body: Buffer.concat(chunks).toString() })
      res.writeHead(200, { "content-type": "application/json" })
      res.end(JSON.stringify({ text: "ok" }))
    })
  })
  await new Promise((r) => upstream.listen(0, "127.0.0.1", r))
  t.after(() => upstream.close())
  const upstreamUrl = `http://127.0.0.1:${upstream.address().port}/api/devices/infer`

  const sock = brokerSocketPath(dir)
  const broker = await startBroker({ socketPath: sock, upstreamInferUrl: upstreamUrl, deviceToken: "device-secret", runId: "r1" })
  t.after(() => broker.close())

  const call = (method, path, body) => new Promise((resolveCall, rejectCall) => {
    const req = http.request({ socketPath: sock, method, path }, (res) => {
      const chunks = []
      res.on("data", (c) => chunks.push(c))
      res.on("end", () => resolveCall({ status: res.statusCode, body: Buffer.concat(chunks).toString() }))
    })
    req.on("error", rejectCall)
    if (body) req.write(body)
    req.end()
  })

  const okRes = await call("POST", "/infer", JSON.stringify({ runId: "r1" }))
  assert.equal(okRes.status, 200)
  assert.equal(seen.length, 1)
  assert.equal(seen[0].auth, "Bearer device-secret", "broker injects the token upstream")
  assert.equal(seen[0].body, JSON.stringify({ runId: "r1" }))

  assert.equal((await call("GET", "/infer")).status, 404)
  assert.equal((await call("POST", "/anything-else", "{}")).status, 404)
  // a body naming any other run is refused: no cross-run spending
  assert.equal((await call("POST", "/infer", JSON.stringify({ runId: "r2" }))).status, 403)
  assert.equal((await call("POST", "/infer", "not json")).status, 400)
  // oversized bodies: connection cut before reaching upstream
  await assert.rejects(() => call("POST", "/infer", JSON.stringify({ runId: "r1", pad: "x".repeat(70000) })), /hang up|ECONNRESET/)
  assert.equal(seen.length, 1, "non-/infer and foreign runs never reach upstream")
  // the container side never sees the token: it just POSTs to the socket
  assert.ok(!okRes.body.includes("device-secret"))
})

test("broker socket lives inside the task worktree", () => {
  assert.ok(brokerSocketPath("/x/.dock-worktrees/r/task-a1").startsWith("/x/.dock-worktrees/r/task-a1/"))
})
