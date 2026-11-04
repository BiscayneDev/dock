/**
 * Runtime Registry
 *
 * To add a custom runtime:
 *   1. Create a new file in lib/runtimes/ (e.g. langchain.ts)
 *   2. Implement the AgentRuntime interface from ./types
 *   3. Register it in this file with registerRuntime()
 *   4. Set AGENT_RUNTIME=your-runtime-id in .env.local
 */

import type { AgentRuntime } from "./types"
import { OpenClawRuntime } from "./openclaw"
import { OllamaRuntime } from "./ollama"
import { StubRuntime } from "./stub"
import { IsolatedRuntime } from "./isolated"

// Re-export types for consumers
export type { AgentRuntime, RuntimeSession, ActivateParams, ChatParams } from "./types"

// ── Registry ────────────────────────────────────────────────────────────────

interface RuntimeEntry {
  /** The runtime class constructor */
  create: () => AgentRuntime
  /** Alternative IDs that also match this runtime */
  aliases: string[]
}

const registry = new Map<string, RuntimeEntry>()

/**
 * Register a runtime so it can be selected via AGENT_RUNTIME env var.
 *
 * @param id Primary identifier (used in env var)
 * @param create Factory function that creates the runtime instance
 * @param aliases Alternative names that also resolve to this runtime
 */
export function registerRuntime(
  id: string,
  create: () => AgentRuntime,
  aliases: string[] = []
) {
  registry.set(id, { create, aliases })
}

/** List all registered runtime IDs (including aliases) */
export function listRuntimes(): string[] {
  const ids: string[] = []
  for (const [id, entry] of registry) {
    ids.push(id, ...entry.aliases)
  }
  return ids
}

/** Get the names of registered runtimes (primary IDs only) */
export function listRuntimeNames(): Array<{ id: string; name: string }> {
  const result: Array<{ id: string; name: string }> = []
  for (const [id, entry] of registry) {
    const instance = entry.create()
    result.push({ id, name: instance.name })
  }
  return result
}

// ── Built-in runtimes ───────────────────────────────────────────────────────

registerRuntime("openclaw", () => new OpenClawRuntime())
registerRuntime("ollama", () => new OllamaRuntime(), ["local", "lmstudio", "llamacpp"])
registerRuntime("demo", () => new StubRuntime(), ["stub"])
registerRuntime("isolated", () => new IsolatedRuntime(), ["isolated-local", "bwrap"])

// ── Factory ─────────────────────────────────────────────────────────────────

function createRuntime(): AgentRuntime {
  const provider = process.env.AGENT_RUNTIME?.toLowerCase() ?? "openclaw"

  // On Vercel or explicit demo mode, use stub
  if (process.env.VERCEL || process.env.VERCEL_ENV || provider === "demo") {
    return new StubRuntime()
  }

  // Look up in registry
  for (const [id, entry] of registry) {
    if (id === provider || entry.aliases.includes(provider)) {
      return entry.create()
    }
  }

  // Default to OpenClaw
  return new OpenClawRuntime()
}

/** Singleton runtime instance */
export const runtime = createRuntime()
