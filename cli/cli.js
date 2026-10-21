#!/usr/bin/env node

import { execSync, spawn } from "node:child_process"
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs"
import { resolve, basename } from "node:path"
import { createInterface } from "node:readline"

// ── Colors (no dependencies) ────────────────────────────────────────────────

const bold = (s) => `\x1b[1m${s}\x1b[0m`
const dim = (s) => `\x1b[2m${s}\x1b[0m`
const green = (s) => `\x1b[32m${s}\x1b[0m`
const cyan = (s) => `\x1b[36m${s}\x1b[0m`
const purple = (s) => `\x1b[35m${s}\x1b[0m`
const red = (s) => `\x1b[31m${s}\x1b[0m`
const yellow = (s) => `\x1b[33m${s}\x1b[0m`
const bgCyan = (s) => `\x1b[46m\x1b[30m${s}\x1b[0m`

const hideCursor = () => process.stdout.write("\x1b[?25l")
const showCursor = () => process.stdout.write("\x1b[?25h")

// ── Config ───────────────────────────────────────────────────────────────────

const REPO_URL = "https://github.com/BiscayneDev/dock.git"
const DEFAULT_DIR = "dock"

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

// ── Helpers ──────────────────────────────────────────────────────────────────

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

function run(cmd, opts = {}) {
  try {
    execSync(cmd, { stdio: "pipe", ...opts })
    return true
  } catch {
    return false
  }
}

function hasCommand(cmd) {
  try {
    execSync(`which ${cmd}`, { stdio: "pipe" })
    return true
  } catch {
    return false
  }
}

// ── Spinner with elapsed time ────────────────────────────────────────────────

function spinner(text) {
  const frames = ["\u2847", "\u2801\u2847", "\u2803\u2847", "\u2807\u2847", "\u2846", "\u2844", "\u2840\u2846", "\u2840\u2844"]
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

// ── Arrow-key select prompt ──────────────────────────────────────────────────

function select(question, options) {
  // options: [{ label, value, hint? }]
  // Fallback to numbered list if not a TTY
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
      // Move cursor up to rewrite options (except first render)
      process.stdout.write(`\x1b[${options.length}A`)
      options.forEach((opt, i) => {
        const prefix = i === selected ? cyan("  > ") : "    "
        const label = i === selected ? bold(opt.label) : dim(opt.label)
        const hint = opt.hint ? (i === selected ? ` ${dim(opt.hint)}` : ` ${dim(opt.hint)}`) : ""
        process.stdout.write(`\x1b[2K${prefix}${label}${hint}\n`)
      })
    }

    // Initial render
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
      // Ctrl+C
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

      // Enter
      if (key === "\r" || key === "\n") {
        process.stdin.setRawMode(false)
        process.stdin.pause()
        process.stdin.removeListener("data", onKey)
        showCursor()

        // Rewrite the question line with the selected value
        const totalLines = options.length + 1
        process.stdout.write(`\x1b[${options.length}A`)
        for (let i = 0; i < options.length; i++) {
          process.stdout.write(`\x1b[2K\n`)
        }
        process.stdout.write(`\x1b[${options.length}A`)
        process.stdout.write(`\x1b[1A\x1b[2K  ${green("\u2713")} ${bold(question)} ${cyan(options[selected].label)}\n`)

        resolvePromise(options[selected].value)
        return
      }

      // Arrow keys come as escape sequences: \x1b[A (up), \x1b[B (down)
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

// ── Box renderer ─────────────────────────────────────────────────────────────

function box(lines) {
  const cols = Math.min(Math.max(process.stdout.columns || 50, 50), 60)
  const inner = cols - 4 // 2 for border + 2 for padding
  const top = `  \u250C${ "\u2500".repeat(cols - 2)}\u2510`
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

// ── Generate .env.local ──────────────────────────────────────────────────────

function writeEnvLocal(projectPath, runtime) {
  const lines = [
    "# Generated by create-shipyard-app",
    "",
    "# ── Agent Runtime ────────────────────────────────────────────────",
    `AGENT_RUNTIME=${runtime}`,
    "",
  ]

  if (runtime === "openclaw") {
    lines.push(
      "# ── OpenClaw Gateway ─────────────────────────────────────────────",
      "OPENCLAW_GATEWAY_URL=http://127.0.0.1:18789",
      "OPENCLAW_GATEWAY_TOKEN=",
      "",
    )
  }

  if (runtime === "ollama") {
    lines.push(
      "# ── Ollama / Local Models ────────────────────────────────────────",
      "OLLAMA_BASE_URL=http://127.0.0.1:11434",
      "OLLAMA_MODEL=llama3.2",
      "",
    )
  }

  lines.push(
    "# ── Agent Delivery ───────────────────────────────────────────────",
    "AGENT_DELIVERY_CHANNEL=telegram",
    "AGENT_DELIVERY_TARGET=",
    "",
    "# ── Agent Workspace ──────────────────────────────────────────────",
    "AGENT_WORKSPACE=~/clawd",
    "",
    "# ── Mission Control URL ──────────────────────────────────────────",
    "NEXT_PUBLIC_MC_URL=http://localhost:3000",
    "",
  )

  writeFileSync(resolve(projectPath, ".env.local"), lines.join("\n"))
}

// ── Banner ───────────────────────────────────────────────────────────────────

function printBanner() {
  console.log()
  console.log(cyan("        |"))
  console.log(cyan("       /|\\"))
  console.log(cyan("      / | \\"))
  console.log(cyan("     /  |  \\"))
  console.log(cyan("    /___|___\\"))
  console.log(purple("   \\___________/"))
  console.log(purple("    \\_________/"))
  console.log()
  console.log(bold(cyan("   S H I P Y A R D   O S")))
  console.log(dim("   The open-source Agent OS"))
  console.log()
}

// ── Detect package managers ──────────────────────────────────────────────────

function detectPackageManagers() {
  const managers = []
  if (hasCommand("npm")) managers.push("npm")
  if (hasCommand("pnpm")) managers.push("pnpm")
  if (hasCommand("yarn")) managers.push("yarn")
  return managers
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  setupCleanExit()

  // ── Parse args ──────────────────────────────────────────────────────────
  const args = process.argv.slice(2)
  const skipPrompts = args.includes("--yes") || args.includes("-y")
  let targetDir = args.find((a) => !a.startsWith("-")) || ""

  // ── Check prerequisites ─────────────────────────────────────────────────
  if (!hasCommand("git")) {
    console.log(red("  Error: git is required but not installed."))
    console.log(dim("  Install it from https://git-scm.com"))
    process.exit(1)
  }

  // ── Banner ──────────────────────────────────────────────────────────────
  printBanner()

  // ── Step 1: "Where to dock?" ────────────────────────────────────────────
  if (!targetDir) {
    if (skipPrompts) {
      targetDir = DEFAULT_DIR
    } else {
      targetDir = await ask(
        `  ${cyan("?")} ${bold("Where to dock?")} ${dim(`(${DEFAULT_DIR})`)} ${cyan("\u203A")} `,
        DEFAULT_DIR
      )
    }
  }

  const projectPath = resolve(process.cwd(), targetDir)
  const projectName = basename(projectPath)

  if (existsSync(projectPath)) {
    const contents = readdirSync(projectPath)
    if (contents.length > 0) {
      console.log(red(`  That berth is taken \u2014 directory "${projectName}" already exists.`))
      process.exit(1)
    }
  }

  // ── Step 2: "Choose your runtime" ───────────────────────────────────────
  let runtime = "demo"
  if (!skipPrompts) {
    console.log()
    runtime = await select("Choose your runtime", [
      { label: "OpenClaw", value: "openclaw", hint: "Local agent runtime (recommended)" },
      { label: "Ollama", value: "ollama", hint: "Run local LLMs (Llama, Mistral, etc.)" },
      { label: "Demo Mode", value: "demo", hint: "Try Dock with mock data, no setup needed" },
    ])
  }

  // ── Step 3: "Package manager" ───────────────────────────────────────────
  const detected = detectPackageManagers()
  let pm = detected[0] || "npm"

  if (!skipPrompts && detected.length > 1) {
    console.log()
    const pmOptions = detected.map((m) => ({
      label: m,
      value: m,
      hint: "(detected)",
    }))
    pm = await select("Package manager", pmOptions)
  } else if (skipPrompts) {
    // Auto-detect: prefer pnpm > yarn > npm
    if (detected.includes("pnpm")) pm = "pnpm"
    else if (detected.includes("yarn")) pm = "yarn"
    else pm = "npm"
  }

  // ── Step 4: "Setting sail..." ───────────────────────────────────────────
  console.log()
  console.log(bold("  Setting sail..."))
  console.log()

  // 4a. Clone
  const cloneSpinner = spinner("Cloning Dock...")
  const cloned = run(`git clone --depth 1 ${REPO_URL} "${projectPath}"`)
  if (!cloned) {
    cloneSpinner.fail("Failed to clone repository")
    console.log(dim(`  Try manually: git clone ${REPO_URL}`))
    process.exit(1)
  }
  run(`rm -rf "${projectPath}/.git"`)
  run(`git init`, { cwd: projectPath })
  cloneSpinner.stop(`Cloned into ${cyan(projectName)}`)

  // 4b. Write .env.local
  const envSpinner = spinner("Writing .env.local...")
  writeEnvLocal(projectPath, runtime)
  envSpinner.stop("Configured .env.local")

  // 4c. Install dependencies
  const installSpinner = spinner(`Installing with ${pm}...`)
  const installCmd = pm === "yarn" ? "yarn" : `${pm} install`
  const installed = run(installCmd, { cwd: projectPath })
  if (!installed) {
    installSpinner.fail("Failed to install dependencies")
    console.log(dim(`  cd ${projectName} && ${installCmd}`))
    process.exit(1)
  }
  const installElapsed = installSpinner
  installSpinner.stop(`Dependencies installed with ${cyan(pm)}`)

  // ── Step 5: Post-install summary ────────────────────────────────────────
  const runtimeLabels = { openclaw: "OpenClaw", ollama: "Ollama", demo: "Demo Mode" }
  const runtimeLabel = runtimeLabels[runtime] || runtime
  const devCmd = pm === "yarn" ? "yarn dev" : `${pm} run dev`

  console.log()
  box([
    bold("Your Dock is ready, Captain."),
    "",
    `${dim("Project")}      ${bold(projectName)}`,
    `${dim("Runtime")}      ${runtimeLabel}`,
    `${dim("Installed")}    ${pm}`,
    "",
    `${cyan("cd")} ${projectName}`,
    `${cyan(devCmd)}`,
    "",
    dim("The setup wizard opens at localhost:3000"),
  ])
  console.log()

  // ── Launch dev server? ──────────────────────────────────────────────────
  if (!skipPrompts) {
    const start = await ask(`  ${cyan("?")} ${bold("Launch the dev server now?")} ${dim("(Y/n)")} ${cyan("\u203A")} `, "y")
    if (start.toLowerCase() === "y" || start.toLowerCase() === "yes") {
      console.log()

      const devBin = pm === "yarn" ? "yarn" : pm
      const devArgs = pm === "yarn" ? ["dev"] : ["run", "dev"]

      const child = spawn(devBin, devArgs, {
        cwd: projectPath,
        stdio: "inherit",
      })

      setTimeout(() => {
        const openCmd =
          process.platform === "darwin"
            ? "open"
            : process.platform === "win32"
              ? "start"
              : "xdg-open"
        run(`${openCmd} http://localhost:3000`)
      }, 3000)

      child.on("close", (code) => {
        process.exit(code || 0)
      })

      process.on("SIGINT", () => child.kill("SIGINT"))
      process.on("SIGTERM", () => child.kill("SIGTERM"))
      return
    }
  }

  console.log(dim("  Fair winds, Captain."))
  console.log()
}

main().catch((err) => {
  showCursor()
  console.error(red(`  Error: ${err.message}`))
  process.exit(1)
})
