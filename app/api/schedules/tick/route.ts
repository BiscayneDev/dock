import { NextResponse } from "next/server"
import { readFile, writeFile, mkdir } from "fs/promises"
import { join, dirname } from "path"
import { currentUser, sessionClient } from "@/lib/tenancy"
import { agentTokenAuthorized } from "@/lib/agent-auth"
import { isDue, calculateNextRun, dueSchedules, scheduleFeedId, type AgentSchedule } from "@/lib/schedules"
import { adminClient } from "@/lib/tenancy"
import { enqueueRun } from "@/lib/queue"
import { resolveModelRef } from "@/lib/inference"
import { resolveAgentExplore } from "@/lib/agent-flags"
import { CHIEF_RUNTIME_KEY } from "@/lib/chief-key"
import { getWatermark, setWatermark } from "@/lib/watermark-store"
import { nextWatermark, shouldProcess, NO_WATERMARK, type Watermark } from "@/lib/watermarks"

const DATA_PATH = join(process.cwd(), "data", "schedules.json")
const AGENT_KEY = /^[a-z0-9_-]{1,64}$/
const DEFAULT_BUDGET_CENTS = 100

interface WorkspaceRow {
  id: string
  owner_id: string
}

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

/**
 * POST /api/schedules/tick
 *
 * Check all schedules and enqueue a task run for any that are due.
 * Each schedule has a watermark (`schedule:<id>`) recording its last successful
 * tick; a tick that errors does not advance the watermark. Duplicate cron
 * firings are deduped via shouldProcess against that watermark.
 */
/**
 * Gate: allow either a signed-in browser session or a valid agent token
 * (DOCK_AGENT_TOKEN via Authorization: Bearer / x-dock-agent-token).
 * Anonymous callers must not be able to force paid runs.
 */
async function authorized(request: Request): Promise<boolean> {
  if (agentTokenAuthorized(request)) return true
  try {
    const supabase = await sessionClient()
    const user = await currentUser(supabase)
    return Boolean(user)
  } catch {
    return false
  }
}

export async function POST(request: Request) {
  if (!(await authorized(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const now = new Date()
  const schedules = await readSchedules()
  const results: Array<{ id: string; name: string; status: "executed" | "skipped" | "error"; error?: string }> = []

  const admin = adminClient()
  const { data: wsData } = await admin.from("workspaces").select("id, owner_id").limit(1)
  const workspace = (wsData as WorkspaceRow[] | null)?.[0]
  if (!workspace) {
    return NextResponse.json({ executed: 0, total: schedules.length, results: [], error: "no workspace" }, { status: 503 })
  }

  let changed = false

  for (const schedule of dueSchedules(now, schedules)) {
    if (!isDue(schedule, now)) {
      results.push({ id: schedule.id, name: schedule.name, status: "skipped" })
      continue
    }

    const feedId = scheduleFeedId(schedule.id)
    const current: Watermark = workspace ? await getWatermark(workspace.owner_id, feedId) : NO_WATERMARK
    const tickItem = { id: schedule.id, createdAt: now.toISOString() }
    if (!shouldProcess(tickItem, current)) {
      results.push({ id: schedule.id, name: schedule.name, status: "skipped" })
      continue
    }

    try {
      const agentKey = AGENT_KEY.test(schedule.agent) ? schedule.agent : CHIEF_RUNTIME_KEY
      const model = resolveModelRef(agentKey)
      if (!model) throw new Error(`No model configured for agent "${agentKey}"`)

      const run = await enqueueRun(admin, {
        workspaceId: workspace.id,
        ownerId: workspace.owner_id,
        projectId: null,
        agentId: null,
        agentKey,
        target: "cloud",
        prompt: schedule.prompt,
        model,
        budgetCents: DEFAULT_BUDGET_CENTS,
        explore: await resolveAgentExplore(agentKey),
      })

      // Mark the run so the intel feed can badge it as scheduled, and attach
      // the watermark the run was launched with (payload.since).
      const markedPayload = {
        ...run.payload,
        prompt: schedule.prompt,
        scheduleId: schedule.id,
        scheduleFeedId: feedId,
        since: current,
      }
      await admin.from("task_runs").update({ payload: markedPayload }).eq("id", run.id)

      // The watermark marks the schedule's last successful tick: only advance on enqueue success.
      await setWatermark(workspace.id, workspace.owner_id, feedId, nextWatermark([tickItem], current))

      schedule.lastRunAt = now.toISOString()
      schedule.lastStatus = "success"
      schedule.lastError = null
      schedule.nextRunAt = calculateNextRun(schedule).toISOString()
      changed = true

      results.push({ id: schedule.id, name: schedule.name, status: "executed" })
    } catch (err) {
      schedule.lastStatus = "error"
      schedule.lastError = err instanceof Error ? err.message : "Unknown error"
      schedule.nextRunAt = calculateNextRun(schedule).toISOString()
      changed = true

      results.push({ id: schedule.id, name: schedule.name, status: "error", error: schedule.lastError ?? undefined })
    }
  }

  if (changed) {
    await writeSchedules(schedules)
  }

  const executed = results.filter((r) => r.status === "executed").length
  return NextResponse.json({ executed, total: schedules.length, results })
}
