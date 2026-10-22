import { NextResponse } from "next/server"
import { readFile, writeFile } from "fs/promises"
import { join } from "path"

const DATA_PATH = join(process.cwd(), "data", "agents.json")

export interface AgentData {
  id: string
  name: string
  emoji: string
  role: string
  accent: string
  description: string
  tags: string[]
  isChief?: boolean
  budget?: number
}

// ── Storage helpers ──────────────────────────────────────────────────────────

async function readAgentsFromFile(): Promise<AgentData[]> {
  try {
    const raw = await readFile(DATA_PATH, "utf-8")
    return JSON.parse(raw) as AgentData[]
  } catch {
    return []
  }
}

async function writeAgentsToFile(agents: AgentData[]): Promise<void> {
  await writeFile(DATA_PATH, JSON.stringify(agents, null, 2), "utf-8")
}

async function readAgents(): Promise<AgentData[]> {
  if (process.env.KV_REST_API_URL) {
    try {
      const { kv } = await import("@vercel/kv")
      const agents = await kv.get<AgentData[]>("agents")
      if (agents && agents.length > 0) return agents
    } catch {
      // Fall through to file
    }
  }
  return readAgentsFromFile()
}

async function writeAgents(agents: AgentData[]): Promise<void> {
  if (process.env.KV_REST_API_URL) {
    try {
      const { kv } = await import("@vercel/kv")
      await kv.set("agents", agents)
      return
    } catch {
      // Fall through to file
    }
  }
  await writeAgentsToFile(agents)
}

// ── Route handlers ───────────────────────────────────────────────────────────

export async function GET() {
  const agents = await readAgents()
  return NextResponse.json(agents)
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as Partial<AgentData>
    const agents = await readAgents()

    const newAgent: AgentData = {
      id: `agent-${Date.now()}`,
      name: body.name ?? "New Agent",
      emoji: body.emoji ?? "🤖",
      role: body.role ?? "",
      accent: body.accent ?? "#6366f1",
      description: body.description ?? "",
      tags: body.tags ?? [],
    }

    const updated = [...agents, newAgent]
    await writeAgents(updated)

    return NextResponse.json(newAgent, { status: 201 })
  } catch {
    return NextResponse.json({ error: "Failed to create agent" }, { status: 400 })
  }
}
