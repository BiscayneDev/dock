import { NextResponse } from "next/server"
import { adminClient } from "@/lib/tenancy"
import { isUuid } from "@/lib/assistant-store"
import { authenticateDevice, touchDevice } from "@/lib/devices"
import { inferForDevice } from "@/lib/home-runs"

export const dynamic = "force-dynamic"
export const maxDuration = 300

/**
 * One model call for a run this device holds, through Dock's inference path with the owner's configured models.
 * The prompt comes from the run, not from the device. Budget and spend use the same ledger as cloud runs.
 */
export async function POST(request: Request) {
  const auth = await authenticateDevice(request)
  if (!auth.ok) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }
  if (typeof body.run_id !== "string" || !isUuid(body.run_id)) {
    return NextResponse.json({ error: "run_id is required" }, { status: 400 })
  }
  const admin = adminClient()
  try {
    const result = await inferForDevice(admin, auth.deviceId, body.run_id)
    await touchDevice(admin, auth.deviceId).catch(() => null)
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
    return NextResponse.json(result.value)
  } catch {
    return NextResponse.json({ error: "Inference failed" }, { status: 500 })
  }
}
