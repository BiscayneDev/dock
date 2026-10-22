import { NextResponse } from "next/server"
import { writeFile, readFile, mkdir } from "fs/promises"
import { join, dirname } from "path"
import { TEAM_TEMPLATES } from "@/lib/agent-templates"
import { DEFAULT_CHIEF_NAME } from "@/lib/chief-key"

const SETUP_PATH = join(process.cwd(), "data", "setup.json")
const ENV_LOCAL_PATH = join(process.cwd(), ".env.local")

interface SetupPayload {
  userName?: string
  assistantName?: string
  runtimeType?: string
  gatewayUrl?: string
  gatewayToken?: string
  ollamaUrl?: string
  ollamaModel?: string
  deliveryTarget?: string
  deliveryChannel?: string
  workspace?: string
  companyName?: string
  teamTemplate?: string
  anthropicAdminKey?: string
  demoMode?: boolean
}

// ── POST — save setup config + write .env.local ─────────────────────────────

export async function POST(request: Request) {
  try {
    const body = await request.json() as SetupPayload
    const isDemoMode = body.demoMode === true

    const runtimeType = isDemoMode ? "demo" : (body.runtimeType || "openclaw")

    // Store only non-secret config in setup.json
    const data = {
      completed: true,
      demoMode: isDemoMode,
      runtimeType,
      userName: body.userName || "",
      assistantName: body.assistantName || DEFAULT_CHIEF_NAME,
      gatewayUrl: isDemoMode ? "" : (body.gatewayUrl || ""),
      ollamaUrl: runtimeType === "ollama" ? (body.ollamaUrl || "http://127.0.0.1:11434") : "",
      ollamaModel: runtimeType === "ollama" ? (body.ollamaModel || "") : "",
      deliveryTarget: isDemoMode ? "" : (body.deliveryTarget || ""),
      deliveryChannel: isDemoMode ? "" : (body.deliveryChannel || "telegram"),
      workspace: body.workspace || "~/clawd",
      companyName: body.companyName || "",
      completedAt: new Date().toISOString(),
    }

    await mkdir(dirname(SETUP_PATH), { recursive: true })
    await writeFile(SETUP_PATH, JSON.stringify(data, null, 2), "utf-8")

    // Auto-create .env.local with secrets + config
    if (!isDemoMode) {
      const envLines: string[] = [`AGENT_RUNTIME=${runtimeType}`]
      if (runtimeType === "openclaw") {
        if (body.gatewayUrl) envLines.push(`OPENCLAW_GATEWAY_URL=${body.gatewayUrl}`)
        if (body.gatewayToken) envLines.push(`OPENCLAW_GATEWAY_TOKEN=${body.gatewayToken}`)
      } else if (runtimeType === "ollama") {
        envLines.push(`OLLAMA_BASE_URL=${body.ollamaUrl || "http://127.0.0.1:11434"}`)
        if (body.ollamaModel) envLines.push(`OLLAMA_MODEL=${body.ollamaModel}`)
      }
      if (body.deliveryTarget) envLines.push(`AGENT_DELIVERY_TARGET=${body.deliveryTarget}`)
      if (body.deliveryChannel) envLines.push(`AGENT_DELIVERY_CHANNEL=${body.deliveryChannel}`)
      if (body.workspace) envLines.push(`AGENT_WORKSPACE=${body.workspace}`)
      envLines.push(`NEXT_PUBLIC_MC_URL=http://localhost:3000`)
      if (body.anthropicAdminKey) envLines.push(`ANTHROPIC_ADMIN_KEY=${body.anthropicAdminKey}`)

      if (envLines.length > 0) {
        try {
          // If .env.local exists, merge new keys (don't overwrite existing)
          let existingContent = ""
          try {
            existingContent = await readFile(ENV_LOCAL_PATH, "utf-8")
          } catch {
            // File doesn't exist — that's fine
          }

          const existingKeys = new Set(
            existingContent
              .split("\n")
              .filter((l) => l.trim() && !l.startsWith("#"))
              .map((l) => l.split("=")[0])
          )

          const newLines = envLines.filter((line) => {
            const key = line.split("=")[0]
            return !existingKeys.has(key)
          })

          if (existingContent && newLines.length > 0) {
            // Append missing keys
            const content = existingContent.trimEnd() + "\n" + newLines.join("\n") + "\n"
            await writeFile(ENV_LOCAL_PATH, content, "utf-8")
          } else if (!existingContent) {
            // Create new file
            await writeFile(ENV_LOCAL_PATH, envLines.join("\n") + "\n", "utf-8")
          }
        } catch {
          // Non-fatal — user can still copy manually
        }
      }
    }

    // Seed default agents if agents.json is empty or missing
    try {
      const agentsPath = join(process.cwd(), "data", "agents.json")
      let needsSeed = false
      try {
        const existing = await readFile(agentsPath, "utf-8")
        const parsed = JSON.parse(existing)
        if (!Array.isArray(parsed) || parsed.length === 0) needsSeed = true
      } catch {
        needsSeed = true
      }
      if (needsSeed) {
        // Use team template if specified, otherwise fall back to startup template
        const template = TEAM_TEMPLATES.find((t) => t.id === body.teamTemplate) ?? TEAM_TEMPLATES[0]
        const seedAgents = template.agents.map((a) => ({
          ...a,
          // Override the chief agent's name with the user's chosen assistant name
          name: a.isChief && body.assistantName ? body.assistantName : a.name,
          isChief: a.isChief || undefined,
        }))
        await writeFile(agentsPath, JSON.stringify(seedAgents, null, 2), "utf-8")
      }
    } catch {
      // Non-fatal
    }

    // Seed demo tasks if demo mode
    if (isDemoMode) {
      try {
        const tasksPath = join(process.cwd(), "data", "tasks.json")
        const demoTasks = [
          { id: "demo-1", title: "Research competitor pricing models", column: "backlog", priority: "high", assignee: "scout", tags: ["research", "demo"], isDemo: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
          { id: "demo-2", title: "Build landing page hero section", column: "in-progress", priority: "medium", assignee: "builder", tags: ["frontend", "demo"], isDemo: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
          { id: "demo-3", title: "Review partnership proposal from Acme", column: "in-review", priority: "high", assignee: "deal-flow", tags: ["partnerships", "demo"], isDemo: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
          { id: "demo-4", title: "Audit DeFi yield positions", column: "backlog", priority: "low", assignee: "baron", tags: ["defi", "demo"], isDemo: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
          { id: "demo-5", title: "Set up CI/CD pipeline", column: "done", priority: "medium", assignee: "builder", tags: ["devops", "demo"], isDemo: true, description: "Completed: GitHub Actions pipeline configured with lint, test, and deploy stages.", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
        ]
        await writeFile(tasksPath, JSON.stringify(demoTasks, null, 2), "utf-8")
      } catch {
        // Non-fatal
      }
    }

    return NextResponse.json({ ok: true, envWritten: !isDemoMode })
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to save config"
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}

// ── DELETE — reset setup (re-run wizard) ────────────────────────────────────

export async function DELETE() {
  try {
    const data = {
      completed: false,
      resetAt: new Date().toISOString(),
    }
    await mkdir(dirname(SETUP_PATH), { recursive: true })
    await writeFile(SETUP_PATH, JSON.stringify(data, null, 2), "utf-8")
    return NextResponse.json({ ok: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to reset setup"
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
