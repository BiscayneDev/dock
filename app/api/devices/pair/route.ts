import { NextResponse } from "next/server"
import { adminClient } from "@/lib/tenancy"
import { redeemPairing } from "@/lib/devices"
import { normalizePairingCode } from "@/lib/device-rules"

export const dynamic = "force-dynamic"

/**
 * Exchanges a one-time pairing code for a device token. Unauthenticated by design (the code is the secret);
 * the code is single use and expires after 10 minutes. The token is returned once and never stored in plaintext.
 */
export async function POST(request: Request) {
  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }
  const code = normalizePairingCode(body.code)
  if (!code) return NextResponse.json({ error: "Invalid pairing code" }, { status: 400 })
  try {
    const paired = await redeemPairing(adminClient(), code)
    if (!paired) return NextResponse.json({ error: "Pairing code is invalid, used, or expired" }, { status: 401 })
    return NextResponse.json({ deviceId: paired.deviceId, deviceToken: paired.deviceToken }, { status: 201 })
  } catch {
    return NextResponse.json({ error: "Pairing failed" }, { status: 500 })
  }
}
