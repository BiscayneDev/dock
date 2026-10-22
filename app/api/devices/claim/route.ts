import { NextResponse } from "next/server"
import { adminClient } from "@/lib/tenancy"
import { authenticateDevice, claimHomeRun, touchDevice } from "@/lib/devices"
import { proposedActionFromPayload } from "@/lib/task-runs"

export const dynamic = "force-dynamic"

/**
 * Claims the next queued home run for this device. The claim counts as a heartbeat.
 * Returns { run: null } when nothing is queued. Never falls back to the cloud worker.
 */
export async function POST(request: Request) {
  const auth = await authenticateDevice(request)
  if (!auth.ok) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const admin = adminClient()
  try {
    await touchDevice(admin, auth.deviceId)
    const run = await claimHomeRun(admin, auth.deviceId)
    if (!run) return NextResponse.json({ run: null })
    return NextResponse.json({
      run: {
        id: run.id,
        agentKey: run.agentKey,
        model: run.model,
        budgetCents: run.budgetCents,
        spentCents: run.spentCents,
        attempt: run.attempts,
        leaseUntil: run.leaseUntil,
        proposedAction: proposedActionFromPayload(run.payload),
      },
    })
  } catch {
    return NextResponse.json({ error: "Claim failed" }, { status: 500 })
  }
}
