import { NextResponse } from "next/server"
import { requireMobileOrOwner } from "@/lib/mobile-auth-server"

export const dynamic = "force-dynamic"

/**
 * Authenticated connectivity check for the mobile app: the connect screen
 * calls this after pairing so a wrong or revoked credential fails loudly
 * instead of silently "connecting".
 */
export async function GET(request: Request) {
  const denied = await requireMobileOrOwner(request, "tasks:read")
  if (denied) return denied
  return NextResponse.json({ ok: true })
}
