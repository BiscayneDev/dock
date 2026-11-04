import type { AgentRuntime, RuntimeSession } from "./types"

export class StubRuntime implements AgentRuntime {
  readonly name = "Demo"
  readonly id = "demo"
  // Prompt-level worktree hints are not confinement: this runtime cannot enforce isolation.
  readonly enforcesWorktreeIsolation = false

  async healthCheck() {
    return { ok: true, version: "demo" }
  }

  async listSessions(): Promise<RuntimeSession[]> {
    return []
  }

  async chat(): Promise<string> {
    return "Running in demo mode — connect an agent runtime to activate chat."
  }

  async activate(): Promise<void> {
    // No-op in demo mode
  }

  async testDelivery(): Promise<void> {
    // No-op in demo mode
  }
}
