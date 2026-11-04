import { NextResponse } from "next/server"
import { requireMobileOrOwner } from "@/lib/mobile-auth-server"
import { registerPushToken, unregisterPushToken } from "@/lib/expo-push"

export const dynamic = "force-dynamic"

/** Register the mobile app's Expo push token. Mobile token or owner session. */
export async function POST(request: Request) {
  const denied = await requireMobileOrOwner(request, "push:register")
  if (denied) return denied
  const body = (await request.json().catch(() => ({}))) as {
    token?: unknown
    platform?: unknown
    deviceId?: unknown
  }
  if (typeof body.token !== "string" || !body.token.trim()) {
    return NextResponse.json({ error: "token required" }, { status: 400 })
  }
  try {
    await registerPushToken(
      body.token.trim(),
      typeof body.platform === "string" ? body.platform : "ios",
      typeof body.deviceId === "string" ? body.deviceId : undefined,
    )
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "could not register token" },
      { status: 400 },
    )
  }
}

/** Revoke a device's push token (device identity = the token itself). */
export async function DELETE(request: Request) {
  const denied = await requireMobileOrOwner(request, "push:register")
  if (denied) return denied
  const body = (await request.json().catch(() => ({}))) as { token?: unknown }
  if (typeof body.token !== "string" || !body.token.trim()) {
    return NextResponse.json({ error: "token required" }, { status: 400 })
  }
  return NextResponse.json({ ok: await unregisterPushToken(body.token.trim()) })
}
