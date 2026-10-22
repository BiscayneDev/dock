import { NextResponse } from "next/server"
import { adminClient } from "@/lib/tenancy"
import { isUuid } from "@/lib/assistant-store"
import { authenticateDevice, heldRun, touchDevice } from "@/lib/devices"
import { addEvent, markRunning } from "@/lib/queue"
import { deviceWorkerId, isDeviceEventKind } from "@/lib/device-rules"

export const dynamic = "force-dynamic"

interface Context {
  params: Promise<{ id: string }>
}

/** Appends an allowed event to a run this device holds. 'started' moves the run to running. */
export async function POST(request: Request, context: Context) {
  const auth = await authenticateDevice(request)
  if (!auth.ok) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { id } = await context.params
  if (!isUuid(id)) return NextResponse.json({ error: "Run not found" }, { status: 404 })
  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }
  if (!isDeviceEventKind(body.kind)) return NextResponse.json({ error: "Event kind not allowed" }, { status: 400 })
  const data = body.data && typeof body.data === "object" && !Array.isArray(body.data) ? (body.data as Record<string, unknown>) : {}
  const admin = adminClient()
  try {
    const run = await heldRun(admin, id, auth.deviceId)
    if (!run) return NextResponse.json({ error: "Run is not leased to this device" }, { status: 409 })
    if (body.kind === "started") await markRunning(admin, id, deviceWorkerId(auth.deviceId))
    await addEvent(admin, id, body.kind, { ...data, device: auth.name })
    await touchDevice(admin, auth.deviceId)
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: "Event failed" }, { status: 500 })
  }
}
