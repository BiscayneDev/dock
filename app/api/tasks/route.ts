import { NextResponse } from "next/server"
import { readFile, writeFile } from "fs/promises"
import { join } from "path"
import type { Task } from "@/lib/tasks"
import { enrichTaskBrief } from "@/lib/task-enrichment"
import { quoteBriefTools } from "@/lib/brief-quote"
import { appendEvent, ensureTaskConversation } from "@/lib/conversations"
import { CHIEF_RUNTIME_KEY } from "@/lib/chief-key"

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

// ── Route handlers ───────────────────────────────────────────────────────────

export async function GET() {
  const tasks = await readTasks()
  return NextResponse.json(tasks)
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const tasks = await readTasks()

    const newTask: Task = {
      id: `task-${Date.now()}`,
      title: body.title,
      description: body.description || "",
      column: body.column || "backlog",
      priority: body.priority || "medium",
      assignee: body.assignee || "unassigned",
      tags: body.tags || [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    if (newTask.column === "backlog" || newTask.column === "planning") {
      const enrichment = await enrichTaskBrief(newTask)
      newTask.enrichedTitle = enrichment.enrichedTitle
      newTask.enrichedDescription = enrichment.enrichedDescription
      newTask.acceptanceCriteria = enrichment.acceptanceCriteria
      newTask.implementationPlan = enrichment.implementationPlan
      newTask.risks = enrichment.risks
      newTask.toolNeeds = enrichment.toolNeeds
      if (enrichment.toolNeeds.length > 0) {
        const tq = await quoteBriefTools(enrichment.toolNeeds)
        if (tq) {
          newTask.quote = {
            quoteId: tq.quote.quoteId,
            totalUsd: tq.quote.totalUsd,
            steps: tq.detail,
            expiresAt: tq.quote.expiresAt,
          }
        }
      }
    }

    const updated = [...tasks, newTask]
    await writeTasks(updated)

    if (newTask.column === "planning") {
      const conversation = await ensureTaskConversation({
        taskId: newTask.id,
        title: newTask.enrichedTitle ?? newTask.title,
        agent: newTask.assignee === "unassigned" ? CHIEF_RUNTIME_KEY : newTask.assignee,
      })
      await appendEvent(conversation.id, {
        type: "task.linked",
        agent: newTask.assignee === "unassigned" ? CHIEF_RUNTIME_KEY : newTask.assignee,
        summary: `Linked task ${newTask.title} to planning conversation`,
        data: {
          taskId: newTask.id,
          taskTitle: newTask.title,
          column: newTask.column,
        },
      })
    }

    return NextResponse.json(newTask, { status: 201 })
  } catch {
    return NextResponse.json({ error: "Failed to create task" }, { status: 400 })
  }
}
