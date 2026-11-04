import { execFile } from "child_process"
import { promisify } from "util"
import { GATEWAY_URL, GATEWAY_TOKEN, AGENT_DELIVERY_TARGET, BIN } from "../config"
import type { AgentRuntime, RuntimeSession, ActivateParams, ChatParams } from "./types"

const execFileAsync = promisify(execFile)

/** Node 22+ path for openclaw CLI (it checks process.version and rejects <22) */
const NODE22 = "/opt/homebrew/Cellar/node/25.4.0/bin/node"
const OPENCLAW_MJS = "/opt/homebrew/lib/node_modules/openclaw/openclaw.mjs"

function ocExec(args: string[], timeout = 30000) {
  return execFileAsync(NODE22, [OPENCLAW_MJS, ...args], {
    timeout,
    env: { ...process.env, PATH: `/opt/homebrew/Cellar/node/25.4.0/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin` },
  })
}

export class OpenClawRuntime implements AgentRuntime {
  readonly name = "OpenClaw"
  readonly id = "openclaw"
  // Prompt-level worktree hints are not confinement: this runtime cannot enforce isolation.
  readonly enforcesWorktreeIsolation = false

  async healthCheck() {
    try {
      const res = await fetch(`${GATEWAY_URL}/health`, {
        headers: { Authorization: `Bearer ${GATEWAY_TOKEN}` },
        signal: AbortSignal.timeout(5000),
      })
      if (!res.ok) return { ok: false, error: `HTTP ${res.status}` }

      interface HealthData { version?: string; openclaw_version?: string; gateway_version?: string }
      const data = (await res.json().catch(() => ({}))) as HealthData
      const version = data.version ?? data.openclaw_version ?? data.gateway_version
      return { ok: true, version }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "Unreachable" }
    }
  }

  async listSessions(): Promise<RuntimeSession[]> {
    if (!GATEWAY_TOKEN) return []
    try {
      const res = await fetch(`${GATEWAY_URL}/sessions`, {
        headers: { Authorization: `Bearer ${GATEWAY_TOKEN}` },
        signal: AbortSignal.timeout(5000),
      })
      if (!res.ok) return []
      const data: unknown = await res.json()
      if (Array.isArray(data)) return data as RuntimeSession[]
      if (data && typeof data === "object" && "sessions" in data) {
        return (data as { sessions: RuntimeSession[] }).sessions
      }
      return []
    } catch {
      return []
    }
  }

  async chat({ message, sessionId }: ChatParams): Promise<string> {
    try {
      // Resolve the UUID session-id for the main session
      const resolvedId = sessionId ?? await this.resolveMainSessionId()
      const args = ["agent", "--message", message, "--json"]
      if (resolvedId) args.push("--session-id", resolvedId)

      const { stdout } = await ocExec(args, 60000)

      interface CLIResult {
        result?: { payloads?: Array<{ text?: string }> }
        reply?: string; response?: string; text?: string; content?: string; output?: string
      }
      const parsed = JSON.parse(stdout) as CLIResult

      // Prefer structured payloads (gateway response format)
      const payloadText = parsed.result?.payloads?.[0]?.text
      if (payloadText) return payloadText

      return parsed.reply ?? parsed.response ?? parsed.text ?? parsed.content ?? parsed.output ?? stdout.trim()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error("[OpenClaw chat]", msg)
      return "Unable to reach agent runtime. Make sure the gateway is running."
    }
  }

  private async resolveMainSessionId(): Promise<string | undefined> {
    try {
      const { stdout } = await ocExec(["sessions", "--json"], 10000)
      const data = JSON.parse(stdout) as { sessions?: Array<{ key?: string; sessionId?: string }> } | Array<{ key?: string; sessionId?: string }>
      const sessions = Array.isArray(data) ? data : (data.sessions ?? [])
      const main = sessions.find((s) => s.key === "agent:main:main")
      return main?.sessionId
    } catch {
      return undefined
    }
  }

  async activate({ message }: ActivateParams & { message: string }): Promise<void> {
    await ocExec(["agent", "--to", AGENT_DELIVERY_TARGET, "--message", message], 30000).catch(() => null)
  }

  async testDelivery(channel: string, target: string, message: string): Promise<void> {
    await ocExec(["message", "send", "--channel", channel.toLowerCase(), "--target", target, "--message", message], 10000)
  }
}
