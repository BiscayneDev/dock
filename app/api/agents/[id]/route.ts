import { NextResponse } from "next/server"
import { readFile, writeFile } from "fs/promises"
import { join } from "path"
import type { AgentData } from "@/app/api/agents/route"

const DATA_PATH = join(process.cwd(), "data", "agents.json")

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

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json() as Partial<AgentData>
    const agents = await readAgents()

    const index = agents.findIndex((a) => a.id === id)
    if (index === -1) {
      return NextResponse.json({ error: "Agent not found" }, { status: 404 })
    }

    const updatedAgent: AgentData = {
      ...agents[index],
      ...body,
      id: agents[index].id,
      isChief: agents[index].isChief, // preserve the chief flag — can't be changed via API
    }

    const updated = agents.map((a, i) => (i === index ? updatedAgent : a))
    await writeAgents(updated)

    return NextResponse.json(updatedAgent)
  } catch {
    return NextResponse.json({ error: "Failed to update agent" }, { status: 400 })
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const agents = await readAgents()

    const target = agents.find((a) => a.id === id)
    if (!target) {
      return NextResponse.json({ error: "Agent not found" }, { status: 404 })
    }

    if (target.isChief) {
      return NextResponse.json({ error: "The chief of staff cannot be deleted" }, { status: 403 })
    }

    const updated = agents.filter((a) => a.id !== id)
    await writeAgents(updated)

    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: "Failed to delete agent" }, { status: 400 })
  }
}
