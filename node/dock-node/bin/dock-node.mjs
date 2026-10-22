#!/usr/bin/env node
// dock-node: runs Dock home tasks on this machine. Commands:
//   dock-node pair <code> [--server URL] [--name NAME]   store a device token (one-time code from Settings)
//   dock-node run [--local-tools] [--diagnostics]         claim and execute home runs until SIGINT
//   dock-node status                                     show pairing (never prints the token)
import { hostname } from "node:os"
import { createApi, pairDevice, ApiError } from "../src/api.mjs"
import { configPath, loadConfig, saveConfig } from "../src/config.mjs"
import { executeRun } from "../src/executor.mjs"
import { detectLocalTools } from "../src/local-tools.mjs"
import { runLoop } from "../src/loop.mjs"

const DEFAULT_SERVER = "https://dock-harness.vercel.app"

function parseArgs(argv) {
  const positional = []
  const flags = {}
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    if (a.startsWith("--")) {
      const key = a.slice(2)
      const next = argv[i + 1]
      if (next !== undefined && !next.startsWith("--")) {
        flags[key] = next
        i += 1
      } else {
        flags[key] = true
      }
    } else {
      positional.push(a)
    }
  }
  return { positional, flags }
}

function usage() {
  console.log(`dock-node <command>

  pair <code> [--server URL] [--name NAME]   pair this machine (code from Dock Settings, valid 10 minutes)
  run [--local-tools] [--diagnostics]        run queued home tasks; --diagnostics runs tsc before the
                                             model call on runs that ask for it and reports the result
                                             as a run event; --local-tools implies it for those runs
  status                                     show pairing state

Config: ${configPath()}`)
}

async function cmdPair(positional, flags) {
  const code = positional[0]
  if (!code) throw new Error("usage: dock-node pair <code>")
  const server = typeof flags.server === "string" ? flags.server : process.env.DOCK_SERVER || DEFAULT_SERVER
  const name = typeof flags.name === "string" && flags.name.trim() ? flags.name.trim().slice(0, 80) : hostname()
  const paired = await pairDevice({ server, code, name })
  await saveConfig({ server, deviceId: paired.deviceId, deviceToken: paired.deviceToken, name, pairedAt: new Date().toISOString() })
  console.log(`Paired "${name}". Token stored in ${configPath()} (mode 600).`)
  console.log("Start the daemon with: dock-node run")
}

async function cmdStatus() {
  const cfg = await loadConfig()
  if (!cfg) return console.log("Not paired. Run: dock-node pair <code>")
  console.log(`Paired: ${cfg.name} (${cfg.deviceId})`)
  console.log(`Server: ${cfg.server}`)
  console.log(`Config: ${configPath()}`)
}

async function cmdRun(flags) {
  const cfg = await loadConfig()
  if (!cfg) throw new Error("Not paired. Run: dock-node pair <code>")
  const api = createApi({ server: cfg.server, token: cfg.deviceToken })
  const localTools = detectLocalTools({ enabled: Boolean(flags["local-tools"]) })
  const diagnostics = Boolean(flags.diagnostics) || localTools != null
  const controller = new AbortController()
  const onSignal = () => {
    console.log("stopping after the current run...")
    controller.abort()
  }
  process.on("SIGINT", onSignal)
  process.on("SIGTERM", onSignal)
  const log = (msg) => console.log(`${new Date().toISOString()} ${msg}`)
  log(`dock-node ${cfg.name} online (${cfg.server})`)
  if (localTools && !localTools.available) log(localTools.message)
  const result = await runLoop({ api, executeRun, localTools, diagnostics, signal: controller.signal, log })
  log(`stopped (${result.stopped}) after ${result.runs} run(s)`)
  process.exitCode = result.stopped === "revoked" ? 2 : 0
}

async function main() {
  const [command, ...rest] = process.argv.slice(2)
  const { positional, flags } = parseArgs(rest)
  try {
    if (command === "pair") return await cmdPair(positional, flags)
    if (command === "run") return await cmdRun(flags)
    if (command === "status") return await cmdStatus()
    usage()
  } catch (err) {
    const msg = err instanceof ApiError ? `server said ${err.status}: ${err.message}` : err.message
    console.error(`dock-node: ${msg}`)
    process.exitCode = 1
  }
}

main()
