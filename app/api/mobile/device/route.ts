import { NextResponse } from "next/server"
import { assistantContext } from "@/lib/assistant-store"
import { listDevices, revokeDevice } from "@/lib/mobile-pairing"
import { supabaseMobilePairingStore } from "@/lib/mobile-pairing-server"

export const dynamic = "force-dynamic"

/** Owner-only: list paired devices and revoke them individually. */
export async function GET() {
  const ctx = await assistantContext()
  if (!ctx) return NextResponse.json({ error: "Sign in required" }, { status: 401 })
  return NextResponse.json({ devices: await listDevices(supabaseMobilePairingStore(), ctx.workspaceId) })
}

export async function DELETE(request: Request) {
  const ctx = await assistantContext()
  if (!ctx) return NextResponse.json({ error: "Sign in required" }, { status: 401 })
  const body = (await request.json().catch(() => ({}))) as { deviceId?: unknown }
  if (typeof body.deviceId !== "string" || !body.deviceId) {
    return NextResponse.json({ error: "deviceId required" }, { status: 400 })
  }
  return NextResponse.json({ ok: await revokeDevice(supabaseMobilePairingStore(), ctx.workspaceId, body.deviceId) })
}
