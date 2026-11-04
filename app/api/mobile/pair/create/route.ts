import { NextResponse } from "next/server"
import { assistantContext } from "@/lib/assistant-store"
import { createPairingCode, PAIR_CODE_TTL_MS } from "@/lib/mobile-pairing"
import { supabaseMobilePairingStore } from "@/lib/mobile-pairing-server"

export const dynamic = "force-dynamic"

/** Owner-only: mint a short-lived pairing code to show in the Dock web UI. */
export async function POST() {
  const ctx = await assistantContext()
  if (!ctx) return NextResponse.json({ error: "Sign in required" }, { status: 401 })
  const { code, expiresAt } = await createPairingCode(supabaseMobilePairingStore(), ctx.workspaceId)
  return NextResponse.json({ code, expiresAt, ttlMs: PAIR_CODE_TTL_MS })
}
