import { homedir } from "os"
import path from "path"
import { readFileSync } from "fs"

// ── Setup.json migration: warn if secrets are still in JSON ─────
let _setupTokenFallback = ""
try {
  const setupPath = path.join(process.cwd(), "data", "setup.json")
  const raw = readFileSync(setupPath, "utf-8")
  const setup = JSON.parse(raw) as Record<string, string>
  if (setup.gatewayToken) {
    console.warn(
      "[Dock] Gateway token found in data/setup.json — migrate to .env.local: OPENCLAW_GATEWAY_TOKEN=..."
    )
    _setupTokenFallback = setup.gatewayToken
  }
  if (setup.anthropicAdminKey) {
    console.warn(
      "[Dock] Anthropic admin key found in data/setup.json — migrate to .env.local: ANTHROPIC_ADMIN_KEY=..."
    )
  }
} catch {
  // No setup.json or not readable
}

// ── OpenClaw Gateway ─────────────────────────────────────────────
export const GATEWAY_URL = process.env.OPENCLAW_GATEWAY_URL ?? "http://127.0.0.1:18789"
export const GATEWAY_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN || _setupTokenFallback

// ── Agent Delivery ───────────────────────────────────────────────
export const AGENT_DELIVERY_TARGET = process.env.AGENT_DELIVERY_TARGET ?? ""
export const AGENT_DELIVERY_CHANNEL = process.env.AGENT_DELIVERY_CHANNEL ?? "telegram"

// ── Workspace paths ──────────────────────────────────────────────
const workspaceRoot = process.env.AGENT_WORKSPACE
  ? path.resolve(process.env.AGENT_WORKSPACE)
  : path.join(homedir(), "clawd")

export const WORKSPACE = {
  root: workspaceRoot,
  memory: path.join(workspaceRoot, "memory"),
  memoryFile: path.join(workspaceRoot, "MEMORY.md"),
  agents: path.join(workspaceRoot, "agents"),
  scout: {
    reports: path.join(workspaceRoot, "agents", "scout", "reports"),
    latest: path.join(workspaceRoot, "agents", "scout", "reports", "latest.json"),
  },
  baron: {
    research: path.join(workspaceRoot, "agents", "baron", "research.md"),
  },
  builder: {
    doc: path.join(workspaceRoot, "agents", "builder", "BUILDER.md"),
  },
  dealFlow: {
    doc: path.join(workspaceRoot, "agents", "deal-flow", "DEAL_FLOW.md"),
  },
}

// ── Google ───────────────────────────────────────────────────────
export const GOG_ACCOUNT = process.env.GOG_ACCOUNT ?? ""

// ── Mission Control public URL ───────────────────────────────────
export const MC_URL =
  process.env.NEXT_PUBLIC_MC_URL ?? "http://localhost:3000"

// ── Ollama ────────────────────────────────────────────────────────
export const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434"
export const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "llama3.2"

// ── CLI paths ────────────────────────────────────────────────────
// Cross-platform: use env override, or try common paths
import { execFileSync } from "child_process"

function findBin(name: string, fallbacks: string[]): string {
  // Allow explicit override via env (e.g. SHIPYARD_BIN_GH=/usr/bin/gh)
  const envKey = `SHIPYARD_BIN_${name.toUpperCase()}`
  if (process.env[envKey]) return process.env[envKey]!

  // Try `which` at startup (fast, cached once)
  try {
    const result = execFileSync("which", [name], { timeout: 2000, encoding: "utf-8" }).trim()
    if (result) return result
  } catch {
    // `which` failed — try fallback paths
  }

  // Try known paths in order
  for (const p of fallbacks) {
    try {
      execFileSync("test", ["-x", p], { timeout: 500 })
      return p
    } catch {
      // Not found at this path
    }
  }

  // Return the bare name — will fail at call site with a clear error
  return name
}

export const BIN = {
  openclaw: findBin("openclaw", ["/opt/homebrew/bin/openclaw", "/usr/local/bin/openclaw"]),
  gog: findBin("gog", ["/opt/homebrew/bin/gog", "/usr/local/bin/gog"]),
  gh: findBin("gh", ["/opt/homebrew/bin/gh", "/usr/local/bin/gh", "/usr/bin/gh"]),
  moonpay: findBin("moonpay", ["/opt/homebrew/bin/moonpay", "/usr/local/bin/moonpay"]),
  node: findBin("node", ["/opt/homebrew/bin/node", "/usr/local/bin/node", "/usr/bin/node"]),
  npm: findBin("npm", ["/opt/homebrew/bin/npm", "/usr/local/bin/npm", "/usr/bin/npm"]),
}
