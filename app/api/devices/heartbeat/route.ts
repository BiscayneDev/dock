import { NextResponse } from "next/server"
import { adminClient } from "@/lib/tenancy"
import { authenticateDevice, touchDevice } from "@/lib/devices"

export const dynamic = "force-dynamic"

/** Device heartbeat (bearer device token). Sets last_seen_at and extends the device's own leases. */
export async function POST(request: Request) {
  const auth = await authenticateDevice(request)
  if (!auth.ok) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  try {
    await touchDevice(adminClient(), auth.deviceId)
    return NextResponse.json({ ok: true, deviceId: auth.deviceId, serverTime: new Date().toISOString() })
  } catch {
    return NextResponse.json({ error: "Heartbeat failed" }, { status: 500 })
  }
}
