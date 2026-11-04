import { NextResponse } from "next/server"
import { requireMobileOrOwner } from "@/lib/mobile-auth-server"
import { registerPushToken } from "@/lib/expo-push"

export const dynamic = "force-dynamic"

/** Register the mobile app's Expo push token. Mobile token or owner session. */
export async function POST(request: Request) {
  const denied = await requireMobileOrOwner(request, "push:register")
  if (denied) return denied
  const body = (await request.json().catch(() => ({}))) as { token?: unknown; platform?: unknown }
  if (typeof body.token !== "string" || !body.token.trim()) {
    return NextResponse.json({ error: "token required" }, { status: 400 })
  }
  try {
    await registerPushToken(body.token.trim(), typeof body.platform === "string" ? body.platform : "ios")
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "could not register token" },
      { status: 400 },
    )
  }
}
