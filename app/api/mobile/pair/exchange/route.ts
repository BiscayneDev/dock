import { NextResponse } from "next/server"
import { exchangePairingCode, PairingError } from "@/lib/mobile-pairing"

export const dynamic = "force-dynamic"

/**
 * Code-gated (not token-gated): the phone exchanges a fresh pairing code for a
 * device-scoped credential. Codes are 6 digits, single-use, five-minute TTL.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    code?: unknown
    platform?: unknown
    deviceLabel?: unknown
  }
  if (typeof body.code !== "string" || !body.code.trim()) {
    return NextResponse.json({ error: "code required" }, { status: 400 })
  }
  try {
    const result = await exchangePairingCode(
      body.code.trim(),
      typeof body.platform === "string" ? body.platform : "ios",
      typeof body.deviceLabel === "string" ? body.deviceLabel : undefined,
    )
    return NextResponse.json(result)
  } catch (err) {
    if (err instanceof PairingError) return NextResponse.json({ error: err.message }, { status: 403 })
    return NextResponse.json({ error: "pairing failed" }, { status: 500 })
  }
}
