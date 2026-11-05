import { NextResponse } from "next/server"
import { readFile } from "fs/promises"
import { join } from "path"
import { listConversations, type ConversationSummary } from "@/lib/conversations"
import { listAlerts, syncDerivedAlertsFromRuns } from "@/lib/alerts"
import type { Task } from "@/lib/tasks"
import { fetchProjects, type Repo } from "@/lib/projects-source"

const TASKS_PATH = join(process.cwd(), "data", "tasks.json")

async function readTasks(): Promise<Task[]> {
  try {
    const raw = await readFile(TASKS_PATH, "utf-8")
    return JSON.parse(raw) as Task[]
  } catch {
    return []
  }
}

function matchesProject(conversation: ConversationSummary, projectName: string): boolean {
  const normalizedProject = projectName.toLowerCase()
  return (
    conversation.project === projectName ||
    conversation.title.toLowerCase().includes(normalizedProject)
  )
}

export interface ProjectWarRoomResponse {
  project: Repo
  relatedConversations: ConversationSummary[]
  relatedTasks: Task[]
  relatedAlerts: Awaited<ReturnType<typeof listAlerts>>
}

export async function getProjectWarRoom(projectName: string): Promise<ProjectWarRoomResponse | null> {
  const [projects, conversationSummaries, tasks] = await Promise.all([
    fetchProjects(),
    listConversations(),
    readTasks(),
  ])

  const project = projects.find((repo) => repo.name === projectName) ?? null
  if (!project) {
    return null
  }

  const relatedConversations = conversationSummaries.filter((conversation) => matchesProject(conversation, projectName))
  const taskIds = new Set(relatedConversations.flatMap((conversation) => (conversation.taskId ? [conversation.taskId] : [])))
  const relatedTasks = tasks.filter((task) => {
    const haystack = [task.title, task.description ?? "", ...task.tags].join(" ").toLowerCase()
    return taskIds.has(task.id) || haystack.includes(projectName.toLowerCase())
  })

  await syncDerivedAlertsFromRuns()
  const alerts = await listAlerts()
  const conversationIds = new Set(relatedConversations.map((conversation) => conversation.id))
  const relatedAlerts = alerts.filter((alert) => {
    if (alert.conversationId && conversationIds.has(alert.conversationId)) return true
    if (alert.taskId && relatedTasks.some((task) => task.id === alert.taskId)) return true
    return false
  })

  return {
    project,
    relatedConversations,
    relatedTasks,
    relatedAlerts,
  }
}

export async function GET(_: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params
  const projectName = decodeURIComponent(name)

  const warRoom = await getProjectWarRoom(projectName)
  if (!warRoom) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 })
  }

  return NextResponse.json(warRoom)
}
