// Headless runs CLI: `dock runs list`, `dock run --agent <key> --prompt "..."`
// and `dock runs watch <id>`. Base URL from DOCK_URL (default http://localhost:3000),
// auth via the DOCK_AGENT_TOKEN bearer header. Pure helpers are exported for tests.

import { setTimeout as sleep } from "node:timers/promises"

// ── Pure helpers (unit-tested, no network) ──────────────────────────────────

const TERMINAL_STATUSES = new Set(["succeeded", "failed", "cancelled", "rejected"])
const POLL_INTERVAL_MS = 1500
const POLL_TIMEOUT_MS = 10 * 60 * 1000

/** True once a run has reached a terminal status the poll loop can stop on. */
export function isTerminalStatus(status) {
  return TERMINAL_STATUSES.has(status)
}

/**
 * Parses CLI args for `run`/`runs` subcommands. Supports `--agent <key>`,
 * `--prompt <text>`, `--project <id>`, `--budget <cents>` and a bare id
 * positional. Returns { flags, positional }.
 */
export function parseRunArgs(args) {
  const flags = {}
  const positional = []
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    const takesValue = ["--agent", "--prompt", "--project", "--budget"]
    if (takesValue.includes(arg) && i + 1 < args.length) {
      flags[arg.slice(2)] = args[++i]
    } else if (!arg.startsWith("--")) {
      positional.push(arg)
    }
  }
  return { flags, positional }
}

/** One aligned table row for `dock runs list` (id/agent/status/created). */
export function formatRunRow(run) {
  const id = String(run.id ?? "").slice(0, 8)
  const agent = String(run.agentKey ?? "—").slice(0, 12)
  const status = String(run.status ?? "—").slice(0, 12)
  const created = String(run.createdAt ?? "").replace("T", " ").slice(0, 19)
  return `  ${id.padEnd(10)}${agent.padEnd(14)}${status.padEnd(14)}${created}`
}

/** Events newer than the last seen index, as printable lines. */
export function newEventLines(events, seenCount) {
  return events
    .slice(seenCount)
    .map((e) => {
      const at = String(e.createdAt ?? "").replace("T", " ").slice(0, 19)
      const data = e.data && Object.keys(e.data).length ? ` ${JSON.stringify(e.data)}` : ""
      return `  [${at}] ${e.kind}${data}`
    })
}

/** Final human-readable output line for a finished run. */
export function runOutcome(run) {
  const head = `  Run ${run.id} ${run.status}`
  if (run.output) return `${head}\n${run.output}`
  if (run.error) return `${head}\n  Error: ${run.error}`
  return head
}

// ── Network plumbing ─────────────────────────────────────────────────────────

function apiConfig() {
  const baseUrl = (process.env.DOCK_URL || "http://localhost:3000").replace(/\/$/, "")
  const token = (process.env.DOCK_AGENT_TOKEN || "").trim()
  return { baseUrl, token }
}

async function apiFetch(path, init = {}) {
  const { baseUrl, token } = apiConfig()
  const res = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status} ${path}`)
  return body
}

async function fetchRun(id) {
  const body = await apiFetch(`/api/runs/${id}`)
  return body.run
}

async function fetchEvents(id) {
  const body = await apiFetch(`/api/runs/${id}/events`)
  return body.events ?? []
}

// ── Commands ─────────────────────────────────────────────────────────────────

async function cmdRunsList() {
  const body = await apiFetch("/api/runs")
  const runs = body.runs ?? []
  console.log(`  ${"ID".padEnd(12)}${"AGENT".padEnd(14)}${"STATUS".padEnd(14)}CREATED`)
  if (!runs.length) console.log("  (no runs)")
  for (const run of runs) console.log(formatRunRow(run))
}

async function cmdRun(flags) {
  if (!flags.agent || !flags.prompt) {
    throw new Error("usage: dock run --agent <key> --prompt \"...\" [--project <id>] [--budget <cents>]")
  }
  const created = await apiFetch("/api/runs", {
    method: "POST",
    body: JSON.stringify({
      agent: flags.agent,
      prompt: flags.prompt,
      ...(flags.project ? { project_id: flags.project } : {}),
      ...(flags.budget ? { budget_cents: Number(flags.budget) } : {}),
    }),
  })
  console.log(`  Queued run ${created.id}`)
  const deadline = Date.now() + POLL_TIMEOUT_MS
  for (;;) {
    const run = await fetchRun(created.id)
    if (isTerminalStatus(run.status)) {
      console.log(runOutcome(run))
      if (run.status !== "succeeded") process.exitCode = 1
      return
    }
    if (Date.now() > deadline) {
      console.log(`  Timed out waiting for run ${created.id} (status: ${run.status})`)
      process.exitCode = 1
      return
    }
    await sleep(POLL_INTERVAL_MS)
  }
}

async function cmdRunsWatch(id) {
  if (!id) throw new Error("usage: dock runs watch <runId>")
  let seen = 0
  const deadline = Date.now() + POLL_TIMEOUT_MS
  for (;;) {
    const events = await fetchEvents(id)
    for (const line of newEventLines(events, seen)) console.log(line)
    seen = Math.max(seen, events.length)
    const run = await fetchRun(id)
    if (isTerminalStatus(run.status)) {
      console.log(runOutcome(run))
      return
    }
    if (Date.now() > deadline) {
      console.log(`  Timed out watching run ${id} (status: ${run.status})`)
      process.exitCode = 1
      return
    }
    await sleep(POLL_INTERVAL_MS)
  }
}

/** Entry point wired from bin/shipyard.js. */
export async function runRunsCommand(args) {
  const subcommand = args[0] || ""
  const { flags, positional } = parseRunArgs(args.slice(1))
  if (subcommand === "list") return cmdRunsList()
  if (subcommand === "watch") return cmdRunsWatch(positional[0])
  // `dock run --agent ... --prompt ...`
  if (subcommand === "" && (flags.agent || flags.prompt)) return cmdRun(flags)
  throw new Error("usage: dock runs list | dock runs watch <id> | dock run --agent <key> --prompt \"...\"")
}
