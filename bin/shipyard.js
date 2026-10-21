#!/usr/bin/env node

import { execSync, spawn } from "node:child_process"
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs"
import { resolve, join, dirname } from "node:path"
import { createInterface } from "node:readline"
import { homedir } from "node:os"
import { callTool } from "./mcp-client.js"

// ── Colors (no dependencies) ────────────────────────────────────────────────

const bold = (s) => `\x1b[1m${s}\x1b[0m`
const dim = (s) => `\x1b[2m${s}\x1b[0m`
const green = (s) => `\x1b[32m${s}\x1b[0m`
const cyan = (s) => `\x1b[36m${s}\x1b[0m`
const purple = (s) => `\x1b[35m${s}\x1b[0m`
const red = (s) => `\x1b[31m${s}\x1b[0m`
const yellow = (s) => `\x1b[33m${s}\x1b[0m`

const hideCursor = () => process.stdout.write("\x1b[?25l")
const showCursor = () => process.stdout.write("\x1b[?25h")

// ── SIGINT handler ───────────────────────────────────────────────────────────

function setupCleanExit() {
  const handler = () => {
    showCursor()
    console.log()
    console.log()
    console.log(dim("  Anchor dropped. See you next time."))
    console.log()
    process.exit(0)
  }
  process.on("SIGINT", handler)
  process.on("SIGTERM", handler)
}

// ── Strip ANSI helper ────────────────────────────────────────────────────────

function stripAnsi(str) {
  return str.replace(/\x1b\[[0-9;]*m/g, "")
}

// ── Prompts ──────────────────────────────────────────────────────────────────

function ask(question, fallback = "") {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close()
      const val = answer.trim()
      resolve(val || fallback)
    })
  })
}

function select(question, options) {
  if (!process.stdin.isTTY) {
    return new Promise((resolve) => {
      console.log(`  ${cyan("?")} ${bold(question)}`)
      options.forEach((opt, i) => {
        console.log(`    ${i + 1}. ${opt.label}${opt.hint ? dim(` ${opt.hint}`) : ""}`)
      })
      const rl = createInterface({ input: process.stdin, output: process.stdout })
      rl.question(`  ${dim("Enter number:")} `, (answer) => {
        rl.close()
        const idx = parseInt(answer, 10) - 1
        const chosen = options[idx] || options[0]
        resolve(chosen.value)
      })
    })
  }

  return new Promise((resolvePromise) => {
    let selected = 0
    hideCursor()

    const render = () => {
      process.stdout.write(`\x1b[${options.length}A`)
      options.forEach((opt, i) => {
        const prefix = i === selected ? cyan("  > ") : "    "
        const label = i === selected ? bold(opt.label) : dim(opt.label)
        const hint = opt.hint ? ` ${dim(opt.hint)}` : ""
        process.stdout.write(`\x1b[2K${prefix}${label}${hint}\n`)
      })
    }

    console.log(`  ${cyan("?")} ${bold(question)}`)
    options.forEach((opt, i) => {
      const prefix = i === selected ? cyan("  > ") : "    "
      const label = i === selected ? bold(opt.label) : dim(opt.label)
      const hint = opt.hint ? ` ${dim(opt.hint)}` : ""
      console.log(`${prefix}${label}${hint}`)
    })

    process.stdin.setRawMode(true)
    process.stdin.resume()
    process.stdin.setEncoding("utf8")

    const onKey = (key) => {
      if (key === "\x03") {
        process.stdin.setRawMode(false)
        process.stdin.pause()
        process.stdin.removeListener("data", onKey)
        showCursor()
        console.log()
        console.log(dim("  Anchor dropped. See you next time."))
        console.log()
        process.exit(0)
      }

      if (key === "\r" || key === "\n") {
        process.stdin.setRawMode(false)
        process.stdin.pause()
        process.stdin.removeListener("data", onKey)
        showCursor()

        process.stdout.write(`\x1b[${options.length}A`)
        for (let i = 0; i < options.length; i++) {
          process.stdout.write(`\x1b[2K\n`)
        }
        process.stdout.write(`\x1b[${options.length}A`)
        process.stdout.write(`\x1b[1A\x1b[2K  ${green("\u2713")} ${bold(question)} ${cyan(options[selected].label)}\n`)

        resolvePromise(options[selected].value)
        return
      }

      if (key === "\x1b[A" || key === "k") {
        selected = (selected - 1 + options.length) % options.length
        render()
      } else if (key === "\x1b[B" || key === "j") {
        selected = (selected + 1) % options.length
        render()
      }
    }

    process.stdin.on("data", onKey)
  })
}

function confirm(question) {
  return ask(`  ${cyan("?")} ${bold(question)} ${dim("(y/N)")} ${cyan("\u203A")} `, "n")
    .then((answer) => answer.toLowerCase() === "y" || answer.toLowerCase() === "yes")
}

// ── Spinner ──────────────────────────────────────────────────────────────────

function spinner(text) {
  const braille = ["\u280B", "\u2819", "\u2839", "\u2838", "\u283C", "\u2834", "\u2826", "\u2827", "\u2807", "\u280F"]
  let i = 0
  const start = Date.now()
  const id = setInterval(() => {
    process.stdout.write(`\r  ${purple(braille[i++ % braille.length])} ${text}`)
  }, 80)
  return {
    stop: (finalText) => {
      clearInterval(id)
      const elapsed = ((Date.now() - start) / 1000).toFixed(1)
      process.stdout.write(`\r  ${green("\u2713")} ${finalText} ${dim(`(${elapsed}s)`)}\n`)
    },
    fail: (finalText) => {
      clearInterval(id)
      process.stdout.write(`\r  ${red("\u2717")} ${finalText}\n`)
    },
  }
}

// ── Box renderer ─────────────────────────────────────────────────────────────

function box(lines) {
  const cols = Math.min(Math.max(process.stdout.columns || 50, 50), 60)
  const inner = cols - 4
  const top = `  \u250C${"\u2500".repeat(cols - 2)}\u2510`
  const bot = `  \u2514${"\u2500".repeat(cols - 2)}\u2518`
  const empty = `  \u2502${" ".repeat(cols - 2)}\u2502`

  console.log(top)
  console.log(empty)
  for (const line of lines) {
    const visible = stripAnsi(line)
    const pad = Math.max(0, inner - visible.length)
    console.log(`  \u2502  ${line}${" ".repeat(pad)}\u2502`)
  }
  console.log(empty)
  console.log(bot)
}

// ── .env.local Utilities ─────────────────────────────────────────────────────

function readEnv(projectRoot) {
  const envPath = join(projectRoot, ".env.local")
  if (!existsSync(envPath)) return []

  const content = readFileSync(envPath, "utf8")
  const entries = []

  for (const line of content.split("\n")) {
    if (line.trim() === "") {
      entries.push({ type: "blank" })
    } else if (line.trim().startsWith("#")) {
      entries.push({ type: "comment", raw: line })
    } else {
      const eqIdx = line.indexOf("=")
      if (eqIdx === -1) {
        entries.push({ type: "comment", raw: line })
      } else {
        entries.push({
          type: "var",
          key: line.slice(0, eqIdx),
          value: line.slice(eqIdx + 1),
        })
      }
    }
  }

  return entries
}

function writeEnv(projectRoot, entries) {
  const envPath = join(projectRoot, ".env.local")
  const lines = entries.map((e) => {
    if (e.type === "blank") return ""
    if (e.type === "comment") return e.raw
    return `${e.key}=${e.value}`
  })
  writeFileSync(envPath, lines.join("\n"))
}

function getEnvVar(entries, key) {
  const entry = entries.find((e) => e.type === "var" && e.key === key)
  return entry ? entry.value : undefined
}

function setEnvVar(entries, key, value) {
  const newEntries = entries.map((e) => {
    if (e.type === "var" && e.key === key) {
      return { ...e, value }
    }
    return e
  })

  const exists = newEntries.some((e) => e.type === "var" && e.key === key)
  if (!exists) {
    return [...newEntries, { type: "var", key, value }]
  }
  return newEntries
}

// ── Agents Utilities ─────────────────────────────────────────────────────────

function readAgents(projectRoot) {
  const agentsPath = join(projectRoot, "data", "agents.json")
  if (!existsSync(agentsPath)) return []
  const content = readFileSync(agentsPath, "utf8")
  return JSON.parse(content)
}

function writeAgents(projectRoot, agents) {
  const agentsPath = join(projectRoot, "data", "agents.json")
  const dir = dirname(agentsPath)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(agentsPath, JSON.stringify(agents, null, 2) + "\n")
}

// ── Find Project Root ────────────────────────────────────────────────────────

function findProjectRoot() {
  let dir = process.cwd()
  while (true) {
    const pkgPath = join(dir, "package.json")
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf8"))
        if (pkg.name === "dock" || pkg.name === "shipyard-os") return dir
      } catch {
        // not valid JSON, keep searching
      }
    }
    const parent = dirname(dir)
    if (parent === dir) {
      console.log()
      console.log(red("  No Dock project found. Run this from inside a Dock project."))
      console.log()
      process.exit(1)
    }
    dir = parent
  }
}

// ── Parse flags ──────────────────────────────────────────────────────────────

function parseFlags(args) {
  const flags = {}
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === "--json") {
      flags.json = true
    } else if (arg === "--open") {
      flags.open = true
    } else if (arg === "--yes" || arg === "-y") {
      flags.yes = true
    } else if (arg === "--runtime" && i + 1 < args.length) {
      flags.runtime = args[++i]
    }
  }
  return flags
}

// ── Commands ─────────────────────────────────────────────────────────────────

async function cmdHelp() {
  console.log()
  box([
    bold(cyan("Dock") + " \u2014 Command Center"),
    "",
    `${bold("dock configure")}     ${dim("Re-configure runtime, delivery, workspace")}`,
    `${bold("dock status")}        ${dim("Health check dashboard")}`,
    `${bold("dock agent list")}    ${dim("List all agents")}`,
    `${bold("dock agent add")}     ${dim("Add a new agent")}`,
    `${bold("dock agent remove")} ${dim("<id> Remove an agent")}`,
    `${bold("dock env list")}      ${dim("Show env vars (secrets redacted)")}`,
    `${bold("dock env set")}       ${dim("<KEY> <VALUE> Set an env var")}`,
    `${bold("dock skill search")} ${dim("<query> Search marketplace skills")}`,
    `${bold("dock skill list")}   ${dim("List all available skills")}`,
    `${bold("dock skill add")}    ${dim("<slug> Install a skill")}`,
    `${bold("dock skill info")}   ${dim("<slug> Show installed skill details")}`,
    `${bold("dock skill remove")} ${dim("<slug> Remove an installed skill")}`,
    `${bold("dock dev")}           ${dim("Start the dev server")}`,
    "",
    dim("Flags: --json, --runtime <val>, --open, --yes"),
  ])
  console.log()
}

async function cmdConfigure(flags) {
  const root = findProjectRoot()
  let entries = readEnv(root)

  // Non-interactive runtime switch
  if (flags.runtime) {
    const valid = ["openclaw", "ollama", "demo"]
    if (!valid.includes(flags.runtime)) {
      console.log(red(`  Invalid runtime: ${flags.runtime}. Use: ${valid.join(", ")}`))
      process.exit(1)
    }
    entries = setEnvVar(entries, "AGENT_RUNTIME", flags.runtime)
    writeEnv(root, entries)
    console.log()
    console.log(`  ${green("\u2713")} Runtime set to ${cyan(flags.runtime)}`)
    console.log(dim("  Configuration updated, Captain."))
    console.log()
    return
  }

  console.log()
  console.log(bold("  Dock Configuration"))
  console.log()

  // 1. Runtime
  const currentRuntime = getEnvVar(entries, "AGENT_RUNTIME") || "demo"
  const runtime = await select("Choose your runtime", [
    { label: "OpenClaw", value: "openclaw", hint: currentRuntime === "openclaw" ? "(current)" : "" },
    { label: "Ollama", value: "ollama", hint: currentRuntime === "ollama" ? "(current)" : "" },
    { label: "Demo Mode", value: "demo", hint: currentRuntime === "demo" ? "(current)" : "" },
  ])
  entries = setEnvVar(entries, "AGENT_RUNTIME", runtime)

  // 2. Runtime-specific config
  if (runtime === "openclaw") {
    console.log()
    const currentGw = getEnvVar(entries, "OPENCLAW_GATEWAY_URL") || "http://127.0.0.1:18789"
    const gwUrl = await ask(
      `  ${cyan("?")} ${bold("Gateway URL")} ${dim(`(${currentGw})`)} ${cyan("\u203A")} `,
      currentGw
    )
    entries = setEnvVar(entries, "OPENCLAW_GATEWAY_URL", gwUrl)

    const currentToken = getEnvVar(entries, "OPENCLAW_GATEWAY_TOKEN") || ""
    const token = await ask(
      `  ${cyan("?")} ${bold("Gateway token")} ${dim(currentToken ? "(keep existing)" : "(none)")} ${cyan("\u203A")} `,
      currentToken
    )
    entries = setEnvVar(entries, "OPENCLAW_GATEWAY_TOKEN", token)
  }

  if (runtime === "ollama") {
    console.log()
    const currentUrl = getEnvVar(entries, "OLLAMA_BASE_URL") || "http://127.0.0.1:11434"
    const ollamaUrl = await ask(
      `  ${cyan("?")} ${bold("Ollama URL")} ${dim(`(${currentUrl})`)} ${cyan("\u203A")} `,
      currentUrl
    )
    entries = setEnvVar(entries, "OLLAMA_BASE_URL", ollamaUrl)

    const currentModel = getEnvVar(entries, "OLLAMA_MODEL") || "llama3.2"
    const model = await ask(
      `  ${cyan("?")} ${bold("Ollama model")} ${dim(`(${currentModel})`)} ${cyan("\u203A")} `,
      currentModel
    )
    entries = setEnvVar(entries, "OLLAMA_MODEL", model)
  }

  // 3. Delivery channel
  console.log()
  const currentChannel = getEnvVar(entries, "AGENT_DELIVERY_CHANNEL") || "telegram"
  const channel = await select("Delivery channel", [
    { label: "Telegram", value: "telegram", hint: currentChannel === "telegram" ? "(current)" : "" },
    { label: "Discord", value: "discord", hint: currentChannel === "discord" ? "(current)" : "" },
    { label: "Signal", value: "signal", hint: currentChannel === "signal" ? "(current)" : "" },
    { label: "WhatsApp", value: "whatsapp", hint: currentChannel === "whatsapp" ? "(current)" : "" },
  ])
  entries = setEnvVar(entries, "AGENT_DELIVERY_CHANNEL", channel)

  // 4. Delivery target
  console.log()
  const currentTarget = getEnvVar(entries, "AGENT_DELIVERY_TARGET") || ""
  const target = await ask(
    `  ${cyan("?")} ${bold("Delivery target")} ${dim(currentTarget ? `(${currentTarget})` : "(e.g. @username)")} ${cyan("\u203A")} `,
    currentTarget
  )
  entries = setEnvVar(entries, "AGENT_DELIVERY_TARGET", target)

  // 5. Workspace path
  const currentWorkspace = getEnvVar(entries, "AGENT_WORKSPACE") || "~/clawd"
  const workspace = await ask(
    `  ${cyan("?")} ${bold("Workspace path")} ${dim(`(${currentWorkspace})`)} ${cyan("\u203A")} `,
    currentWorkspace
  )
  entries = setEnvVar(entries, "AGENT_WORKSPACE", workspace)

  writeEnv(root, entries)
  console.log()
  console.log(`  ${green("\u2713")} Configuration updated, Captain.`)
  console.log()
}

async function cmdStatus(flags) {
  const root = findProjectRoot()
  const entries = readEnv(root)
  const runtime = getEnvVar(entries, "AGENT_RUNTIME") || "unknown"

  const results = {
    runtime: { value: runtime, ok: true },
    gateway: { value: "", ok: false },
    github: { value: "gh CLI", ok: false },
    calendar: { value: "gog CLI", ok: false },
    agents: { value: "0", ok: true },
    workspace: { value: "", ok: false },
  }

  // Check runtime connectivity
  if (runtime === "openclaw") {
    const gwUrl = getEnvVar(entries, "OPENCLAW_GATEWAY_URL") || "http://127.0.0.1:18789"
    results.gateway.value = gwUrl.replace(/^https?:\/\//, "")
    try {
      execSync(`curl -sf --max-time 3 "${gwUrl}/health"`, { stdio: "pipe" })
      results.gateway.ok = true
    } catch {
      results.gateway.ok = false
    }
  } else if (runtime === "ollama") {
    const ollamaUrl = getEnvVar(entries, "OLLAMA_BASE_URL") || "http://127.0.0.1:11434"
    results.gateway.value = ollamaUrl.replace(/^https?:\/\//, "")
    try {
      execSync(`curl -sf --max-time 3 "${ollamaUrl}/api/tags"`, { stdio: "pipe" })
      results.gateway.ok = true
    } catch {
      results.gateway.ok = false
    }
  } else if (runtime === "demo") {
    results.gateway.value = "demo mode"
    results.gateway.ok = true
  }

  // Check gh auth
  try {
    execSync("gh auth status", { stdio: "pipe" })
    results.github.ok = true
  } catch {
    results.github.ok = false
  }

  // Check gog auth
  try {
    execSync("gog auth list", { stdio: "pipe" })
    results.calendar.ok = true
  } catch {
    results.calendar.ok = false
  }

  // Agent count
  const agents = readAgents(root)
  results.agents.value = `${agents.length} active`

  // Workspace check
  const workspace = getEnvVar(entries, "AGENT_WORKSPACE") || "~/clawd"
  const expandedWorkspace = workspace.replace(/^~/, homedir())
  results.workspace.value = workspace
  results.workspace.ok = existsSync(expandedWorkspace)

  // JSON output
  if (flags.json) {
    console.log(JSON.stringify(results, null, 2))
    return
  }

  // Render status table
  const runtimeLabels = { openclaw: "OpenClaw", ollama: "Ollama", demo: "Demo Mode" }
  const check = (ok) => ok ? green("\u2713") : red("\u2717")
  const statusText = (ok, yes, no) => ok ? green(yes) : red(no)

  console.log()
  box([
    bold("Dock Status"),
    "",
    `${dim("Runtime")}       ${bold(runtimeLabels[runtime] || runtime)}          ${check(results.runtime.ok)} ${statusText(results.runtime.ok, "configured", "unknown")}`,
    `${dim("Gateway")}       ${results.gateway.value}   ${check(results.gateway.ok)} ${statusText(results.gateway.ok, "reachable", "unreachable")}`,
    `${dim("GitHub")}        ${results.github.value}        ${check(results.github.ok)} ${statusText(results.github.ok, "authenticated", "not configured")}`,
    `${dim("Calendar")}      ${results.calendar.value}       ${check(results.calendar.ok)} ${statusText(results.calendar.ok, "authenticated", "not configured")}`,
    `${dim("Agents")}        ${results.agents.value}`,
    `${dim("Workspace")}     ${results.workspace.value}         ${check(results.workspace.ok)} ${statusText(results.workspace.ok, "exists", "not found")}`,
  ])
  console.log()
}

async function cmdAgentList(flags) {
  const root = findProjectRoot()
  const agents = readAgents(root)

  if (flags.json) {
    console.log(JSON.stringify(agents, null, 2))
    return
  }

  if (agents.length === 0) {
    console.log()
    console.log(dim("  No agents configured."))
    console.log()
    return
  }

  console.log()

  // Table header
  const header = `  ${bold(padRight("ID", 12))}${bold(padRight("Name", 12))}${bold(padRight("Role", 22))}${bold("Budget")}`
  console.log(header)
  console.log(dim(`  ${"─".repeat(56)}`))

  for (const agent of agents) {
    const budget = agent.budget != null ? `$${agent.budget}/mo` : "-"
    console.log(`  ${padRight(agent.id, 12)}${padRight(agent.name, 12)}${padRight(agent.role, 22)}${budget}`)
  }

  console.log()
}

function padRight(str, len) {
  const visible = stripAnsi(str)
  return str + " ".repeat(Math.max(0, len - visible.length))
}

async function cmdAgentAdd() {
  const root = findProjectRoot()
  const agents = readAgents(root)

  console.log()
  console.log(bold("  Add New Agent"))
  console.log()

  // ID
  let id = ""
  while (!id) {
    id = await ask(`  ${cyan("?")} ${bold("Agent ID")} ${dim("(kebab-case)")} ${cyan("\u203A")} `)
    id = id.toLowerCase().replace(/[^a-z0-9-]/g, "")
    if (!id) {
      console.log(red("  ID is required (lowercase letters, numbers, hyphens)"))
      continue
    }
    if (agents.some((a) => a.id === id)) {
      console.log(red(`  Agent "${id}" already exists`))
      id = ""
    }
  }

  const name = await ask(`  ${cyan("?")} ${bold("Name")} ${cyan("\u203A")} `) || id
  const emoji = await ask(`  ${cyan("?")} ${bold("Emoji")} ${dim("(single character)")} ${cyan("\u203A")} `) || "\u2699"
  const role = await ask(`  ${cyan("?")} ${bold("Role")} ${cyan("\u203A")} `) || "Agent"
  const description = await ask(`  ${cyan("?")} ${bold("Description")} ${cyan("\u203A")} `) || ""
  const tagsRaw = await ask(`  ${cyan("?")} ${bold("Tags")} ${dim("(comma-separated)")} ${cyan("\u203A")} `) || ""
  const tags = tagsRaw ? tagsRaw.split(",").map((t) => t.trim()).filter(Boolean) : []
  const budgetStr = await ask(`  ${cyan("?")} ${bold("Monthly budget")} ${dim("(USD)")} ${cyan("\u203A")} `) || "0"
  const budget = parseInt(budgetStr, 10) || 0

  const newAgent = { id, name, emoji, role, description, tags, budget }
  const updatedAgents = [...agents, newAgent]
  writeAgents(root, updatedAgents)

  console.log()
  console.log(`  ${green("\u2713")} New crew member aboard!`)
  console.log(dim(`  Added ${name} (${id}) to data/agents.json`))
  console.log()
}

async function cmdAgentRemove(args, flags) {
  const root = findProjectRoot()
  const agents = readAgents(root)

  const id = args[0]
  if (!id) {
    console.log(red("  Usage: dock agent remove <id>"))
    process.exit(1)
  }

  const agent = agents.find((a) => a.id === id)
  if (!agent) {
    console.log(red(`  Agent "${id}" not found`))
    process.exit(1)
  }

  if (!flags.yes) {
    const yes = await confirm(`Remove agent "${agent.name}" (${id})?`)
    if (!yes) {
      console.log(dim("  Cancelled."))
      return
    }
  }

  const updatedAgents = agents.filter((a) => a.id !== id)
  writeAgents(root, updatedAgents)

  console.log()
  console.log(`  ${green("\u2713")} Crew member discharged.`)
  console.log(dim(`  Removed ${agent.name} (${id}) from data/agents.json`))
  console.log()
}

async function cmdEnvList(flags) {
  const root = findProjectRoot()
  const entries = readEnv(root)

  const vars = entries.filter((e) => e.type === "var")

  if (flags.json) {
    const obj = {}
    for (const v of vars) {
      obj[v.key] = shouldRedact(v.key) ? "****" : v.value
    }
    console.log(JSON.stringify(obj, null, 2))
    return
  }

  if (vars.length === 0) {
    console.log()
    console.log(dim("  No .env.local found or file is empty."))
    console.log()
    return
  }

  console.log()
  for (const v of vars) {
    const display = shouldRedact(v.key) && v.value ? "****" : v.value
    console.log(`  ${bold(v.key)}=${display}`)
  }
  console.log()
}

function shouldRedact(key) {
  const upper = key.toUpperCase()
  return upper.includes("TOKEN") || upper.includes("KEY") || upper.includes("SECRET")
}

async function cmdEnvSet(args) {
  const root = findProjectRoot()

  const key = args[0]
  const value = args[1]

  if (!key || value === undefined) {
    console.log(red("  Usage: dock env set <KEY> <VALUE>"))
    process.exit(1)
  }

  let entries = readEnv(root)
  entries = setEnvVar(entries, key, value)
  writeEnv(root, entries)

  const display = shouldRedact(key) ? "****" : value
  console.log()
  console.log(`  ${green("\u2713")} ${bold(key)}=${display}`)
  console.log()
}

async function cmdDev(flags) {
  const root = findProjectRoot()

  // Detect package manager
  let pm = "npm"
  if (existsSync(join(root, "pnpm-lock.yaml"))) pm = "pnpm"
  else if (existsSync(join(root, "yarn.lock"))) pm = "yarn"

  const bin = pm === "yarn" ? "yarn" : pm
  const args = pm === "yarn" ? ["dev"] : ["run", "dev"]

  console.log()
  console.log(`  ${cyan("\u25B6")} Starting dev server with ${bold(pm)}...`)
  console.log()

  const child = spawn(bin, args, {
    cwd: root,
    stdio: "inherit",
  })

  if (flags.open) {
    setTimeout(() => {
      const openCmd =
        process.platform === "darwin"
          ? "open"
          : process.platform === "win32"
            ? "start"
            : "xdg-open"
      try {
        execSync(`${openCmd} http://localhost:3000`, { stdio: "pipe" })
      } catch {
        // browser open failed silently
      }
    }, 3000)
  }

  child.on("close", (code) => {
    process.exit(code || 0)
  })

  process.on("SIGINT", () => child.kill("SIGINT"))
  process.on("SIGTERM", () => child.kill("SIGTERM"))
}

// ── Skills Utilities ────────────────────────────────────────────────────────

const SKILLS_DIR = join(homedir(), ".shipyard", "skills")
const INSTALLED_REGISTRY = join(SKILLS_DIR, "installed.json")

function ensureSkillsDir() {
  if (!existsSync(SKILLS_DIR)) mkdirSync(SKILLS_DIR, { recursive: true })
}

function readInstalledRegistry() {
  ensureSkillsDir()
  if (!existsSync(INSTALLED_REGISTRY)) return []
  try {
    return JSON.parse(readFileSync(INSTALLED_REGISTRY, "utf8"))
  } catch {
    return []
  }
}

function writeInstalledRegistry(skills) {
  ensureSkillsDir()
  writeFileSync(INSTALLED_REGISTRY, JSON.stringify(skills, null, 2) + "\n")
}

// ── Skill Commands ──────────────────────────────────────────────────────────

async function cmdSkillSearch(args, flags) {
  const query = args.join(" ")
  if (!query) {
    console.log(red("  Usage: dock skill search <query>"))
    process.exit(1)
  }

  const s = spinner(`Searching for "${query}"...`)
  try {
    const result = await callTool("search_skills", { search: query })
    s.stop(`Found ${result.skills?.length ?? 0} skill(s)`)

    const skills = result.skills || []
    if (flags.json) {
      console.log(JSON.stringify(skills, null, 2))
      return
    }

    if (skills.length === 0) {
      console.log(dim("  No skills found."))
      console.log()
      return
    }

    printSkillTable(skills)
  } catch (err) {
    s.fail("Search failed")
    console.log(red(`  ${err.message}`))
    process.exit(1)
  }
}

async function cmdSkillList(flags) {
  const s = spinner("Fetching skill registry...")
  try {
    const result = await callTool("get_skill_registry", {})
    const skills = result.skills || []
    s.stop(`${skills.length} skill(s) available`)

    if (flags.json) {
      console.log(JSON.stringify(skills, null, 2))
      return
    }

    if (skills.length === 0) {
      console.log(dim("  No skills in registry."))
      console.log()
      return
    }

    printSkillTable(skills)
  } catch (err) {
    s.fail("Failed to fetch registry")
    console.log(red(`  ${err.message}`))
    process.exit(1)
  }
}

function printSkillTable(skills) {
  console.log()
  const header = `  ${padRight("Name", 24)}${padRight("Version", 10)}${padRight("Installs", 10)}${padRight("Tags", 20)}${"Description"}`
  console.log(header)
  console.log(dim(`  ${"─".repeat(90)}`))

  for (const sk of skills) {
    const name = sk.emoji ? `${sk.emoji} ${sk.name || sk.slug}` : (sk.name || sk.slug)
    const version = sk.version || "-"
    const installs = sk.install_count != null ? String(sk.install_count) : "-"
    const tags = (sk.tags || []).slice(0, 3).join(", ")
    const desc = (sk.description || "").slice(0, 40)
    console.log(`  ${padRight(name, 24)}${padRight(version, 10)}${padRight(installs, 10)}${padRight(tags, 20)}${dim(desc)}`)
  }
  console.log()
}

async function cmdSkillAdd(args, flags) {
  const slug = args[0]
  if (!slug) {
    console.log(red("  Usage: dock skill add <slug>"))
    process.exit(1)
  }

  const s = spinner(`Installing ${slug}...`)
  try {
    const result = await callTool("install_skill", { slug })
    s.stop(`Installed ${result.skill?.name || slug}`)

    const skill = result.skill || {}
    const skillDir = join(SKILLS_DIR, slug)
    if (!existsSync(skillDir)) mkdirSync(skillDir, { recursive: true })

    // Save manifest
    if (result.manifest) {
      writeFileSync(join(skillDir, "manifest.json"), JSON.stringify(result.manifest, null, 2) + "\n")
    }

    // Save instructions
    if (result.instructions) {
      writeFileSync(join(skillDir, "skill.md"), result.instructions)
    }

    // Save tool definitions
    if (skill.tool_definitions && skill.tool_definitions.length > 0) {
      writeFileSync(join(skillDir, "tools.json"), JSON.stringify(skill.tool_definitions, null, 2) + "\n")
    }

    // Update installed registry
    const installed = readInstalledRegistry()
    const existing = installed.findIndex((s) => s.slug === slug)
    const entry = {
      slug,
      name: skill.name || slug,
      version: skill.version || "unknown",
      emoji: skill.emoji || "",
      description: skill.description || "",
      installedAt: new Date().toISOString(),
    }
    if (existing >= 0) {
      installed[existing] = entry
    } else {
      installed.push(entry)
    }
    writeInstalledRegistry(installed)

    // Print summary
    if (flags.json) {
      console.log(JSON.stringify(result, null, 2))
      return
    }

    console.log()
    if (skill.requires_env && skill.requires_env.length > 0) {
      console.log(yellow("  Required environment variables:"))
      for (const env of skill.requires_env) {
        console.log(`    ${bold(env)}`)
      }
      console.log()
    }

    if (skill.requires_bins && skill.requires_bins.length > 0) {
      console.log(yellow("  Required binaries:"))
      for (const bin of skill.requires_bins) {
        console.log(`    ${bold(bin)}`)
      }
      console.log()
    }

    if (result.api_references && result.api_references.length > 0) {
      console.log(cyan("  API references:"))
      for (const ref of result.api_references) {
        console.log(`    ${bold(ref.name)} ${dim(ref.base_url || "")} ${dim(`(${ref.relationship || "related"})`)}`)
      }
      console.log()
    }

    console.log(dim(`  Saved to ~/.shipyard/skills/${slug}/`))
    console.log()
  } catch (err) {
    s.fail(`Failed to install ${slug}`)
    console.log(red(`  ${err.message}`))
    process.exit(1)
  }
}

async function cmdSkillInfo(args, flags) {
  const slug = args[0]
  if (!slug) {
    console.log(red("  Usage: dock skill info <slug>"))
    process.exit(1)
  }

  const skillDir = join(SKILLS_DIR, slug)
  if (!existsSync(skillDir)) {
    console.log(red(`  Skill "${slug}" is not installed.`))
    console.log(dim(`  Run: dock skill add ${slug}`))
    process.exit(1)
  }

  const manifestPath = join(skillDir, "manifest.json")
  const toolsPath = join(skillDir, "tools.json")
  const instructionsPath = join(skillDir, "skill.md")

  const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : null
  const tools = existsSync(toolsPath) ? JSON.parse(readFileSync(toolsPath, "utf8")) : []
  const hasInstructions = existsSync(instructionsPath)

  // Also check installed registry for metadata
  const installed = readInstalledRegistry()
  const entry = installed.find((s) => s.slug === slug)

  if (flags.json) {
    console.log(JSON.stringify({ slug, manifest, tools, entry }, null, 2))
    return
  }

  console.log()
  const name = entry?.emoji ? `${entry.emoji} ${entry?.name || slug}` : (entry?.name || slug)
  console.log(bold(`  ${name}`))
  if (entry?.description) console.log(dim(`  ${entry.description}`))
  console.log()
  console.log(`  ${dim("Version")}      ${entry?.version || "unknown"}`)
  console.log(`  ${dim("Installed")}    ${entry?.installedAt ? new Date(entry.installedAt).toLocaleDateString() : "unknown"}`)
  console.log(`  ${dim("Path")}         ~/.shipyard/skills/${slug}/`)
  console.log(`  ${dim("Instructions")} ${hasInstructions ? green("yes") : dim("none")}`)
  console.log(`  ${dim("Tools")}        ${tools.length > 0 ? `${tools.length} tool(s)` : dim("none")}`)

  if (tools.length > 0) {
    console.log()
    console.log(bold("  Tool definitions:"))
    for (const tool of tools) {
      console.log(`    ${cyan(tool.name || tool.function?.name || "unnamed")} ${dim(tool.description || tool.function?.description || "")}`)
    }
  }

  if (manifest && manifest.requires_env && manifest.requires_env.length > 0) {
    console.log()
    console.log(yellow("  Required env vars:"))
    for (const env of manifest.requires_env) {
      console.log(`    ${bold(env)}`)
    }
  }

  console.log()
}

async function cmdSkillRemove(args, flags) {
  const slug = args[0]
  if (!slug) {
    console.log(red("  Usage: dock skill remove <slug>"))
    process.exit(1)
  }

  const skillDir = join(SKILLS_DIR, slug)
  if (!existsSync(skillDir)) {
    console.log(red(`  Skill "${slug}" is not installed.`))
    process.exit(1)
  }

  if (!flags.yes) {
    const yes = await confirm(`Remove skill "${slug}"?`)
    if (!yes) {
      console.log(dim("  Cancelled."))
      return
    }
  }

  // Remove directory
  rmSync(skillDir, { recursive: true, force: true })

  // Update installed registry
  const installed = readInstalledRegistry()
  const updated = installed.filter((s) => s.slug !== slug)
  writeInstalledRegistry(updated)

  console.log()
  console.log(`  ${green("\u2713")} Removed skill "${slug}"`)
  console.log(dim(`  Deleted ~/.shipyard/skills/${slug}/`))
  console.log()
}

// ── Command Router ───────────────────────────────────────────────────────────

async function main() {
  setupCleanExit()

  const args = process.argv.slice(2)
  const command = args[0] || "help"
  const subcommand = args[1] || ""
  const restArgs = args.slice(2)
  const flags = parseFlags(args)

  switch (command) {
    case "help":
    case "--help":
    case "-h":
      await cmdHelp()
      break

    case "configure":
      await cmdConfigure(flags)
      break

    case "status":
      await cmdStatus(flags)
      break

    case "agent":
      switch (subcommand) {
        case "list":
          await cmdAgentList(flags)
          break
        case "add":
          await cmdAgentAdd()
          break
        case "remove":
          await cmdAgentRemove(restArgs, flags)
          break
        default:
          console.log(red(`  Unknown agent command: ${subcommand || "(none)"}`))
          console.log(dim("  Available: agent list, agent add, agent remove <id>"))
          process.exit(1)
      }
      break

    case "env":
      switch (subcommand) {
        case "list":
          await cmdEnvList(flags)
          break
        case "set":
          await cmdEnvSet(restArgs)
          break
        default:
          console.log(red(`  Unknown env command: ${subcommand || "(none)"}`))
          console.log(dim("  Available: env list, env set <KEY> <VALUE>"))
          process.exit(1)
      }
      break

    case "skill":
      switch (subcommand) {
        case "search":
          await cmdSkillSearch(restArgs, flags)
          break
        case "list":
          await cmdSkillList(flags)
          break
        case "add":
          await cmdSkillAdd(restArgs, flags)
          break
        case "info":
          await cmdSkillInfo(restArgs, flags)
          break
        case "remove":
          await cmdSkillRemove(restArgs, flags)
          break
        default:
          console.log(red(`  Unknown skill command: ${subcommand || "(none)"}`))
          console.log(dim("  Available: skill search, skill list, skill add, skill info, skill remove"))
          process.exit(1)
      }
      break

    case "dev":
      await cmdDev(flags)
      break

    default:
      console.log(red(`  Unknown command: ${command}`))
      await cmdHelp()
      process.exit(1)
  }
}

main().catch((err) => {
  showCursor()
  console.error(red(`  Error: ${err.message}`))
  process.exit(1)
})
