import { execFileSync, spawn } from "node:child_process"
import { confinedCommand, resolveTaskWorktree, loadRegisteredRepos } from "./isolation.mjs"

// Optional local tools adapter. Off unless the daemon is started with --local-tools. Detects a cua-driver CLI on PATH.
// It reports what it found; it does not drive the desktop. Computer use is a later task (P4).

export const LOCAL_TOOL_NAME = "cua-driver"

export function defaultWhich(name) {
  try {
    const out = execFileSync("which", [name], { stdio: ["ignore", "pipe", "ignore"] }).toString().trim()
    return out || null
  } catch {
    return null
  }
}

export function detectLocalTools({ enabled, which = defaultWhich }) {
  if (!enabled) return null
  const path = which(LOCAL_TOOL_NAME)
  if (path) return { available: true, tool: LOCAL_TOOL_NAME, path }
  return { available: false, tool: LOCAL_TOOL_NAME, message: "no local desktop tools" }
}

// --- diagnostics tool -------------------------------------------------------
// NOTE: dock-node is .mjs and cannot import lib/tool-diagnostics.ts directly,
// so the tsc-line regex is duplicated here in minimal form. Keep it in sync
// with parseTscOutput in lib/tool-diagnostics.ts.

const TSC_LINE = /^([^(()\n]+)\((\d+)(?:,(\d+))?\):\s+(error|warning)\s+((?:TS\d+):\s+)?(.*)$/

function parseTscOutputInline(text) {
  const diags = []
  for (const raw of text.split(/\r?\n/)) {
    const m = TSC_LINE.exec(raw.trim())
    if (!m) continue
    const diag = {
      file: m[1].trim(),
      line: Number.parseInt(m[2], 10),
      message: m[6].trim(),
      severity: m[4] === "warning" ? "warning" : "error",
    }
    const col = m[3] ? Number.parseInt(m[3], 10) : undefined
    if (col !== undefined) diag.column = col
    diags.push(diag)
  }
  return diags
}

function formatDiagsInline(diags, max = 40) {
  const lines = diags.slice(0, max).map((d) => {
    const col = d.column !== undefined ? `:${d.column}` : ""
    return `${d.severity.toUpperCase()} ${d.file}:${d.line}${col} ${d.message}`
  })
  if (diags.length > max) lines.push(`... and ${diags.length - max} more`)
  return lines.join("\n")
}

// --- diagnostics gating -----------------------------------------------------
// Diagnostics run when the daemon has them enabled (--diagnostics, or --local-tools puts the
// daemon in local-tools mode) AND the run payload asks for them (payload.wantDiagnostics === true,
// surfaced by the claim endpoint as run.wantDiagnostics).
export function shouldRunDiagnostics({ enabled = false, wantDiagnostics = false }) {
  return Boolean(enabled) && wantDiagnostics === true
}

// Runs `npx tsc --noEmit --pretty false` in projectDir (60s timeout) and
// returns a compact diagnostics report string.
//
// Isolation: when DOCK_NODE_ISOLATION=require and projectDir is a task worktree,
// the command runs CONFINED in a fresh container that sees only that worktree
// (see isolation.mjs). When isolation is required but cannot be enforced (no
// container runtime, or the path is not a registered task worktree), the command
// is REFUSED - never run unconfined on the host.
export async function runDiagnosticsTool({ projectDir = process.cwd(), taskRef = null } = {}) {
  let command = "npx"
  let args = ["tsc", "--noEmit", "--pretty", "false"]
  let cwd = projectDir
  if (process.env.DOCK_NODE_ISOLATION === "require" && taskRef) {
    const { resolved } = await resolveTaskWorktree(projectDir, await loadRegisteredRepos(), taskRef)
    const confined = confinedCommand({
      worktreePath: resolved,
      command: ["npx", "tsc", "--noEmit", "--pretty", "false"],
      whichFn: (name) => {
        try {
          return Boolean(execFileSync("which", [name], { stdio: ["ignore", "pipe", "ignore"] }))
        } catch {
          return false
        }
      },
    })
    if (!confined) throw new Error("isolation required but no container runtime available; refusing to run unconfined")
    command = confined.runtime
    args = confined.argv
    cwd = "/"
  }
  const stdout = await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    })
    let out = ""
    const timer = setTimeout(() => child.kill("SIGKILL"), 60_000)
    child.stdout.on("data", (d) => (out += d))
    child.stderr.on("data", (d) => (out += d))
    child.on("error", (err) => {
      clearTimeout(timer)
      reject(err)
    })
    child.on("close", () => {
      clearTimeout(timer)
      resolve(out)
    })
  })
  const diags = parseTscOutputInline(stdout)
  return { total: diags.length, report: formatDiagsInline(diags) }
}
