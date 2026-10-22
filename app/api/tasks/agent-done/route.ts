import { NextResponse } from "next/server"
import { readFile, writeFile } from "fs/promises"
import { join } from "path"
import type { Task } from "@/lib/tasks"
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

// ── POST /api/tasks/agent-done ───────────────────────────────────────────────
// Body: { id, summary? }
// Moves task to "in-review", optionally appends summary to description.

export async function POST(request: Request) {
  const denied = requireAgentToken(request)
  if (denied) return denied

  try {
    const body = await request.json() as { id: string; summary?: string }

    if (!body.id || typeof body.id !== "string") {
      return NextResponse.json({ error: "id is required" }, { status: 400 })
    }

    const tasks = await readTasks()
    const index = tasks.findIndex((t) => t.id === body.id)

    if (index === -1) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 })
    }

    const existing = tasks[index]
    const updatedDescription = body.summary
      ? [existing.description, body.summary].filter(Boolean).join("\n\n---\n\n")
      : existing.description

    const updatedTask: Task = {
      ...existing,
      column: "in-review",
      description: updatedDescription,
      updatedAt: new Date().toISOString(),
    }

    const updated = tasks.map((t, i) => (i === index ? updatedTask : t))
    await writeTasks(updated)

    return NextResponse.json({ id: updatedTask.id, column: updatedTask.column })
  } catch {
    return NextResponse.json({ error: "Failed to mark task done" }, { status: 400 })
  }
}
