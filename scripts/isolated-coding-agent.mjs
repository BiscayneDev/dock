/**
 * Confined coding agent for the "isolated" runtime (lib/runtimes/isolated.ts).
 *
 * This process is launched INSIDE a bubblewrap sandbox whose only writable
 * mount is the task worktree; its environment carries only the inference
 * credentials it needs. The tool layer additionally refuses any path that
 * resolves outside the worktree, so even a sandbox-escape attempt at the
 * syscall layer meets a second refusal here.
 *
 * Inference: OpenAI-compatible chat completions against SHIPYARD_INFERENCE_URL
 * (Shipyard gateway in production; any compatible endpoint in tests). Tools:
 * read_file, write_file, list_files, run_shell (allowlisted: git status/diff,
 * ls, cat, test runners), finish. Step-capped.
 */
import { resolve, relative, sep } from "node:path"
import { pathToFileURL } from "node:url"
import { readFile, writeFile, readdir, mkdir } from "node:fs/promises"
import { execFile } from "node:child_process"
import { promisify } from "node:util"

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

/** Every file path the agent touches resolves inside the worktree or throws. */
export function resolveInsideWorktree(p) {
  const abs = resolve(WORKTREE, p)
  const rel = relative(WORKTREE, abs)
  if (rel === "" ) return abs
  if (rel.startsWith("..") || rel.includes(`..${sep}`) || resolve(abs) !== abs) {
    throw new Error(`path escapes worktree: ${p}`)
  }
  return abs
}

const tools = {
  async read_file({ path }) {
    return readFile(resolveInsideWorktree(path), "utf8").catch((e) => `error: ${e.message}`)
  },
  async write_file({ path, content }) {
    const abs = resolveInsideWorktree(path)
    await mkdir(resolve(abs, ".."), { recursive: true })
    await writeFile(abs, content ?? "", "utf8")
    return `wrote ${path}`
  },
  async list_files({ path }) {
    const abs = resolveInsideWorktree(path ?? ".")
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

async function infer(messages) {
  const res = await fetch(`${INFER_URL}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${INFER_KEY}` },
    body: JSON.stringify({
      model: MODEL,
      messages,
      tools: [
        { type: "function", function: { name: "read_file", description: "Read a file in the worktree", parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } } },
        { type: "function", function: { name: "write_file", description: "Write a file in the worktree", parameters: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] } } },
        { type: "function", function: { name: "list_files", description: "List directory entries", parameters: { type: "object", properties: { path: { type: "string" } } } } },
        { type: "function", function: { name: "run_shell", description: "Run an allowlisted shell command (git status/diff/log/add/commit, ls, cat, npm test, node --test)", parameters: { type: "object", properties: { command: { type: "string" } }, required: ["command"] } } },
        { type: "function", function: { name: "finish", description: "Declare the task complete with a summary", parameters: { type: "object", properties: { summary: { type: "string" } }, required: ["summary"] } } },
      ],
      tool_choice: "auto",
    }),
  })
  if (!res.ok) throw new Error(`inference HTTP ${res.status}`)
  const data = await res.json()
  return data.choices?.[0]?.message ?? {}
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
        await writeFile(resolve(WORKTREE, ".dock-agent-status.json"), JSON.stringify({ ok: true, summary, finishedAt: new Date().toISOString() }))
        return
      }
      const fn = tools[name]
      const result = fn ? await fn(args).catch((e) => `error: ${e.message}`) : `error: unknown tool ${name}`
      log(`${name}(${JSON.stringify(args).slice(0, 80)}) -> ${String(result).slice(0, 80)}`)
      messages.push({ role: "tool", tool_call_id: call.id, content: String(result) })
    }
  }
  await writeFile(resolve(WORKTREE, ".dock-agent-status.json"), JSON.stringify({ ok: false, summary, finishedAt: new Date().toISOString() }))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(async (e) => {
  log(`fatal: ${e.message}`)
  if (WORKTREE) {
    await writeFile(resolve(WORKTREE, ".dock-agent-status.json"), JSON.stringify({ ok: false, summary: e.message, finishedAt: new Date().toISOString() })).catch(() => null)
  }
    process.exitCode = 1
  })
}