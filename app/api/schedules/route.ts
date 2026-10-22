import { NextResponse } from "next/server"
import { readFile, writeFile, mkdir } from "fs/promises"
import { join, dirname } from "path"
import { randomUUID } from "crypto"
import { calculateNextRun, type AgentSchedule } from "@/lib/schedules"

const DATA_PATH = join(process.cwd(), "data", "schedules.json")

async function readSchedules(): Promise<AgentSchedule[]> {
  try {
    const raw = await readFile(DATA_PATH, "utf-8")
    return JSON.parse(raw) as AgentSchedule[]
  } catch {
    return []
  }
}

async function writeSchedules(schedules: AgentSchedule[]): Promise<void> {
  await mkdir(dirname(DATA_PATH), { recursive: true })
  await writeFile(DATA_PATH, JSON.stringify(schedules, null, 2), "utf-8")
}

// GET — list all schedules
export async function GET() {
  const schedules = await readSchedules()
  return NextResponse.json(schedules)
}

// POST — create a new schedule
export async function POST(request: Request) {
  try {
    const body = await request.json() as Partial<AgentSchedule>

    if (!body.name || !body.agent || !body.prompt) {
      return NextResponse.json(
        { error: "name, agent, and prompt are required" },
        { status: 400 }
      )
    }

    const schedule: AgentSchedule = {
      id: randomUUID(),
      name: body.name,
      agent: body.agent,
      prompt: body.prompt,
      frequency: body.frequency ?? "daily",
      hour: body.hour ?? 9,
      dayOfWeek: body.dayOfWeek,
      enabled: body.enabled ?? true,
      lastRunAt: null,
      nextRunAt: null,
      lastStatus: null,
      lastError: null,
      createdAt: new Date().toISOString(),
    }

    // Calculate initial next run
    schedule.nextRunAt = calculateNextRun(schedule).toISOString()

    const schedules = await readSchedules()
    schedules.push(schedule)
    await writeSchedules(schedules)

    return NextResponse.json(schedule, { status: 201 })
  } catch {
    return NextResponse.json({ error: "Failed to create schedule" }, { status: 500 })
  }
}
