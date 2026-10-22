import { NextResponse } from "next/server"
import { assistantContext, isUuid } from "@/lib/assistant-store"
import { adminClient } from "@/lib/tenancy"
import { revokeDevice } from "@/lib/devices"

export const dynamic = "force-dynamic"

interface Context {
  params: Promise<{ id: string }>
}

/** Revokes a device. Its token stops working at once and its leased runs are requeued. Owner only (RLS). */
export async function DELETE(_: Request, context: Context) {
  const ctx = await assistantContext()
  if (!ctx) return NextResponse.json({ error: "Sign in required" }, { status: 401 })
  const { id } = await context.params
  if (!isUuid(id)) return NextResponse.json({ error: "Device not found" }, { status: 404 })
  try {
    const ok = await revokeDevice(ctx.supabase, adminClient(), id)
    if (!ok) return NextResponse.json({ error: "Device not found" }, { status: 404 })
    return NextResponse.json({ id, revoked: true })
  } catch {
    return NextResponse.json({ error: "Could not revoke device" }, { status: 500 })
  }
}
