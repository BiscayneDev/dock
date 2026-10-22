import { NextResponse } from "next/server"
import { assistantContext } from "@/lib/assistant-store"
import { createPairing, listDevices } from "@/lib/devices"
import { PAIRING_TTL_MS } from "@/lib/device-rules"

export const dynamic = "force-dynamic"

const NAME_MAX = 80

/** Owner's devices with online/offline state. Token hashes are never returned. */
export async function GET() {
  const ctx = await assistantContext()
  if (!ctx) return NextResponse.json({ error: "Sign in required" }, { status: 401 })
  try {
    return NextResponse.json({ devices: await listDevices(ctx.supabase) })
  } catch {
    return NextResponse.json({ error: "Could not load devices" }, { status: 500 })
  }
}

/** Starts pairing: creates a device slot and returns a one-time code. The code is shown once. */
export async function POST(request: Request) {
  const ctx = await assistantContext()
  if (!ctx) return NextResponse.json({ error: "Sign in required" }, { status: 401 })
  let body: Record<string, unknown> = {}
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    body = {}
  }
  const raw = typeof body.name === "string" ? body.name.trim() : ""
  const name = raw ? raw.slice(0, NAME_MAX) : "My laptop"
  try {
    const pairing = await createPairing(ctx.supabase, { workspaceId: ctx.workspaceId, ownerId: ctx.userId, name })
    return NextResponse.json(
      {
        id: pairing.deviceId,
        name,
        code: pairing.code,
        expiresAt: pairing.expiresAt,
        ttlSeconds: Math.round(PAIRING_TTL_MS / 1000),
      },
      { status: 201 },
    )
  } catch {
    return NextResponse.json({ error: "Could not start pairing" }, { status: 500 })
  }
}
