import { NextResponse } from "next/server"
import { readFile, writeFile } from "fs/promises"
import { join } from "path"
import type { Task, Agent, Priority } from "@/lib/tasks"
import { requireAgentToken } from "@/lib/agent-auth"

const DATA_PATH = join(process.cwd(), "data", "tasks.json")

// ── Storage helpers ──────────────────────────────────────────────────────────

async function readTasksFromFile(): Promise<Task[]> {
  try {
    const raw = await readFile(DATA_PATH, "utf-8")
    return JSON.parse(raw)
  } catch {
    return []
  }
}

async function writeTasksToFile(tasks: Task[]): Promise<void> {
  await writeFile(DATA_PATH, JSON.stringify(tasks, null, 2), "utf-8")
}

async function readTasks(): Promise<Task[]> {
  if (process.env.KV_REST_API_URL) {
    try {
      const { kv } = await import("@vercel/kv")
      const tasks = await kv.get<Task[]>("tasks")
      return tasks ?? []
    } catch {
      // Fall through to file
    }
  }
  return readTasksFromFile()
}

async function writeTasks(tasks: Task[]): Promise<void> {
  if (process.env.KV_REST_API_URL) {
    try {
      const { kv } = await import("@vercel/kv")
      await kv.set("tasks", tasks)
      return
    } catch {
      // Fall through to file
    }
  }
  await writeTasksToFile(tasks)
}

// ── Valid agent types ────────────────────────────────────────────────────────

const VALID_AGENTS: Agent[] = ["vic", "scout", "deal-flow", "builder", "baron", "unassigned"]

function normalizeAgent(input: string): Agent {
  if (VALID_AGENTS.includes(input as Agent)) return input as Agent
  return "unassigned"
}

// ── POST /api/tasks/agent-spawn ──────────────────────────────────────────────
// Body: { agent, title, description?, priority?, tags? }
// Creates a task in "in-progress" column and returns the task id.

export async function POST(request: Request) {
  const denied = requireAgentToken(request)
  if (denied) return denied

  try {
    const body = await request.json() as {
      agent: string
      title: string
      description?: string
      priority?: string
      tags?: string[]
    }

    if (!body.title || typeof body.title !== "string") {
      return NextResponse.json({ error: "title is required" }, { status: 400 })
    }

    const validPriorities: Priority[] = ["high", "medium", "low"]
    const priority: Priority =
      body.priority && validPriorities.includes(body.priority as Priority)
        ? (body.priority as Priority)
        : "medium"

    const tasks = await readTasks()

    const newTask: Task = {
      id: `task-${Date.now()}`,
      title: body.title,
      description: body.description ?? "",
      column: "in-progress",
      priority,
      assignee: normalizeAgent(body.agent ?? ""),
      tags: body.tags ?? [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    await writeTasks([...tasks, newTask])

    return NextResponse.json(
      { id: newTask.id, title: newTask.title, column: newTask.column },
      { status: 201 }
    )
  } catch {
    return NextResponse.json({ error: "Failed to spawn task" }, { status: 400 })
  }
}
