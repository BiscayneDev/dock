import { NextResponse } from "next/server"
import { agentTokenWorkspace } from "@/lib/tenancy"
import { exchangePairingCode, PairingError } from "@/lib/mobile-pairing"
import { supabaseMobilePairingStore } from "@/lib/mobile-pairing-server"

export const dynamic = "force-dynamic"

const MAX_BODY = 1024

/**
 * Phone-side: trade a 6-digit code for a device-scoped credential. No session;
 * the code is the credential. The store consumes atomically and rate-limits
 * failures per workspace, so guessing is bounded at the database.
 * Workspace binding mirrors the agent token: single-workspace deployments
 * only; multi-workspace fails closed.
 */
export async function POST(request: Request) {
  const raw = await request.text()
  if (raw.length > MAX_BODY) return NextResponse.json({ error: "body too large" }, { status: 413 })
  let body: { code?: unknown; platform?: unknown; deviceLabel?: unknown }
  try {
    body = JSON.parse(raw)
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 })
  }
  if (typeof body.code !== "string" || !/^\d{6}$/.test(body.code.trim())) {
    return NextResponse.json({ error: "6-digit code required" }, { status: 400 })
  }
  const platform = typeof body.platform === "string" ? body.platform.slice(0, 32) : "unknown"
  const deviceLabel = typeof body.deviceLabel === "string" ? body.deviceLabel.slice(0, 80) : undefined

  const tokenWs = await agentTokenWorkspace()
  if (tokenWs === "forbidden") {
    return NextResponse.json({ error: "pairing is not available on this deployment" }, { status: 403 })
  }
  try {
    const result = await exchangePairingCode(
      supabaseMobilePairingStore(),
      tokenWs.workspaceId,
      body.code,
      platform,
      deviceLabel,
    )
    return NextResponse.json(result)
  } catch (err) {
    if (err instanceof PairingError && err.outcome === "rate_limited") {
      return NextResponse.json({ error: err.message }, { status: 429 })
    }
    if (err instanceof PairingError) {
      return NextResponse.json({ error: err.message }, { status: 401 })
    }
    throw err
  }
}
