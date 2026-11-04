/**
 * Confined coding agent for the "isolated" runtime (lib/runtimes/isolated.ts).
 *
 * This process is launched INSIDE a bubblewrap sandbox:
 *  - the task worktree is the only writable host directory;
 *  - the main checkout and sibling worktrees are not mounted at all;
 *  - the main gitdir is read-only (objects via GIT_ALTERNATE, sanitized
 *    config, no hooks); the agent's own ref updates and new objects go to a
 *    per-run scratch dir the host migrates after a clean exit;
 *  - no network namespace (--unshare-net); the ONLY connectivity is a unix
 *    socket relay that forwards POST /v1/chat/completions upstream and holds
 *    the gateway key HOST-SIDE - this process never sees the key;
 *  - /etc is not mounted, so symlinked paths to host config dangle.
 *
 * The tool layer is the second boundary: every path must resolve (lexically
 * AND through symlinks via realpath) inside the worktree.
 *
 * Tools: read_file, write_file, list_files, run_shell (allowlisted), finish.
 * Step-capped. Writes .dock-agent-status.json (ok, summary, commitSha,
 * inferenceKeyVisible) for the host-side finalizer.
 */
import { resolve, relative, sep } from "node:path"
import { pathToFileURL } from "node:url"
import { readFile, writeFile, readdir, mkdir, realpath } from "node:fs/promises"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import http from "node:http"

const run = promisify(execFile)
const WORKTREE = process.env.DOCK_WORKTREE_PATH
const INFER_URL = (process.env.SHIPYARD_INFERENCE_URL ?? "").replace(/\/$/, "")
const INFER_KEY = process.env.SHIPYARD_INFERENCE_API_KEY ?? ""
const MODEL = process.env.DOCK_AGENT_MODEL ?? "auto"
const BRIEF = process.env.DOCK_TASK_BRIEF ?? ""
const MAX_STEPS = Number(process.env.DOCK_AGENT_MAX_STEPS ?? 12)

const SHELL_ALLOW = [/^git (status|diff|log|add|commit)( [^;&|`$]*)?$/, /^ls( [^;&|`$]*)?$/, /^cat [^;&|`$]+$/, /^npm (test|run test)( [^;&|`$]*)?$/, /^node --test( [^;&|`$]*)?$/]

function log(line) {
  process.stdout.write(`[agent] ${line}\n`)
}

/** Lexical boundary: the path must name something inside the worktree. */
export function resolveInsideWorktree(p) {
  const abs = resolve(WORKTREE, p)
  const rel = relative(WORKTREE, abs)
  if (rel === "" ) return abs
  if (rel.startsWith("..") || rel.includes(`..${sep}`)) {
    throw new Error(`path escapes worktree: ${p}`)
  }
  return abs
}

let _wtReal = null
async function worktreeReal() {
  if (!_wtReal) _wtReal = await realpath(WORKTREE)
  return _wtReal
}

function insideReal(wtReal, candidate) {
  const rel = relative(wtReal, candidate)
  return rel === "" || (!rel.startsWith("..") && !rel.includes(`..${sep}`))
}

/**
 * Symlink-aware boundary: resolve the real target (nearest existing ancestor
 * for writes) and require it to live inside the real worktree. A symlink in
 * the worktree pointing at /etc, the gitdir, or a sibling worktree fails here
 * even though the lexical path looks internal.
 */
async function resolveRealInsideWorktree(abs, { forWrite = false } = {}) {
  const wtReal = await worktreeReal()
  if (forWrite) {
    const tail = []
    let cur = abs
    for (;;) {
      const r = await realpath(cur).catch(() => null)
      if (r) {
        const candidate = resolve(r, ...tail.reverse())
        if (!insideReal(wtReal, candidate)) throw new Error(`path escapes worktree through symlink: ${abs}`)
        return abs
      }
      const parent = resolve(cur, "..")
      if (parent === cur) throw new Error(`path escapes worktree: ${abs}`)
      tail.push(cur.slice(parent.length + 1))
      cur = parent
    }
  }
  const real = await realpath(abs)
  if (!insideReal(wtReal, real)) throw new Error(`path escapes worktree through symlink: ${abs}`)
  return abs
}

const tools = {
  async read_file({ path }) {
    const abs = resolveInsideWorktree(path)
    await resolveRealInsideWorktree(abs)
    return readFile(abs, "utf8").catch((e) => `error: ${e.message}`)
  },
  async write_file({ path, content }) {
    const abs = resolveInsideWorktree(path)
    await resolveRealInsideWorktree(abs, { forWrite: true })
    await mkdir(resolve(abs, ".."), { recursive: true })
    await writeFile(abs, content ?? "", "utf8")
    return `wrote ${path}`
  },
  async list_files({ path }) {
    const abs = resolveInsideWorktree(path ?? ".")
    await resolveRealInsideWorktree(abs)
    const entries = await readdir(abs, { withFileTypes: true }).catch(() => [])
    return entries.map((e) => `${e.isDirectory() ? "d" : "f"} ${e.name}`).join("\n") || "(empty)"
  },
  async run_shell({ command }) {
    if (!SHELL_ALLOW.some((re) => re.test(command))) return `error: command not allowed: ${command}`
    try {
      const { stdout, stderr } = await run("sh", ["-c", command], { cwd: WORKTREE, timeout: 60000 })
      return (stdout + stderr).slice(0, 4000) || "(no output)"
    } catch (e) {
      return `error: ${String(e.message).slice(0, 500)}`
    }
  },
}

function inferViaSocket(socketPath, payload) {
  return new Promise((resolvePromise, reject) => {
    const req = http.request({ socketPath, path: "/v1/chat/completions", method: "POST", headers: { "Content-Type": "application/json" } }, (res) => {
      const chunks = []
      res.on("data", (c) => chunks.push(c))
      res.on("end", () => {
        if (res.statusCode !== 200) return reject(new Error(`inference HTTP ${res.statusCode}`))
        try { resolvePromise(JSON.parse(Buffer.concat(chunks).toString("utf8"))) } catch (e) { reject(e) }
      })
    })
    req.on("error", reject)
    req.setTimeout(120000, () => req.destroy(new Error("inference timeout")))
    req.end(payload)
  })
}

const TOOL_DEFS = [
  { type: "function", function: { name: "read_file", description: "Read a file in the worktree", parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } } },
  { type: "function", function: { name: "write_file", description: "Write a file in the worktree", parameters: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] } } },
  { type: "function", function: { name: "list_files", description: "List directory entries", parameters: { type: "object", properties: { path: { type: "string" } } } } },
  { type: "function", function: { name: "run_shell", description: "Run an allowlisted shell command (git status/diff/log/add/commit, ls, cat, npm test, node --test)", parameters: { type: "object", properties: { command: { type: "string" } }, required: ["command"] } } },
  { type: "function", function: { name: "finish", description: "Declare the task complete with a summary", parameters: { type: "object", properties: { summary: { type: "string" } }, required: ["summary"] } } },
]

async function infer(messages) {
  const payload = JSON.stringify({ model: MODEL, messages, tools: TOOL_DEFS, tool_choice: "auto" })
  let data
  if (INFER_URL.startsWith("unix://")) {
    data = await inferViaSocket(INFER_URL.slice("unix://".length), payload)
  } else {
    const res = await fetch(`${INFER_URL}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(INFER_KEY ? { Authorization: `Bearer ${INFER_KEY}` } : {}) },
      body: payload,
    })
    if (!res.ok) throw new Error(`inference HTTP ${res.status}`)
    data = await res.json()
  }
  return data.choices?.[0]?.message ?? {}
}

async function statusPayload(ok, summary) {
  let commitSha = null
  try {
    const { stdout } = await run("git", ["rev-parse", "HEAD"], { cwd: WORKTREE, timeout: 15000 })
    commitSha = stdout.trim() || null
  } catch { commitSha = null }
  return { ok, summary, commitSha, inferenceKeyVisible: Boolean(process.env.SHIPYARD_INFERENCE_API_KEY), finishedAt: new Date().toISOString() }
}

async function main() {
  if (!WORKTREE) throw new Error("DOCK_WORKTREE_PATH required")
  if (!INFER_URL) throw new Error("SHIPYARD_INFERENCE_URL required")
  const messages = [
    { role: "system", content: "You are a coding agent confined to one git worktree. Do the task with the provided tools, run relevant checks, commit your changes on the current branch with git add/commit, then call finish. Never touch paths outside the worktree." },
    { role: "user", content: BRIEF },
  ]
  let summary = "step cap reached"
  for (let step = 0; step < MAX_STEPS; step++) {
    const msg = await infer(messages)
    messages.push(msg)
    const calls = msg.tool_calls ?? []
    if (calls.length === 0) {
      messages.push({ role: "user", content: "Continue with tools, or call finish." })
      continue
    }
    for (const call of calls) {
      const name = call.function?.name
      let args = {}
      try { args = JSON.parse(call.function?.arguments ?? "{}") } catch { args = {} }
      if (name === "finish") {
        summary = String(args.summary ?? "done")
        log(`finish: ${summary}`)
        await writeFile(resolve(WORKTREE, ".dock-agent-status.json"), JSON.stringify(await statusPayload(true, summary)))
        return
      }
      const fn = tools[name]
      const result = fn ? await fn(args).catch((e) => `error: ${e.message}`) : `error: unknown tool ${name}`
      log(`${name}(${JSON.stringify(args).slice(0, 80)}) -> ${String(result).slice(0, 80)}`)
      messages.push({ role: "tool", tool_call_id: call.id, content: String(result) })
    }
  }
  await writeFile(resolve(WORKTREE, ".dock-agent-status.json"), JSON.stringify(await statusPayload(false, summary)))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(async (e) => {
  log(`fatal: ${e.message}`)
  if (WORKTREE) {
    await writeFile(resolve(WORKTREE, ".dock-agent-status.json"), JSON.stringify(await statusPayload(false, e.message))).catch(() => null)
  }
    process.exitCode = 1
  })
}
