import { NextResponse } from "next/server"
import { assistantContext } from "@/lib/assistant-store"
import { adminClient } from "@/lib/tenancy"
import { connectionStatus, createConnectorPairing, revokeWorkspaceConnection } from "@/lib/connector"
import { CONNECTOR_PAIRING_TTL_MS } from "@/lib/connector-rules"
import { buildDinghyConnectUrl } from "@/lib/connector-url"

export const dynamic = "force-dynamic"

// Owner setup for the Settings card. Session only: not in the proxy bearer allowlist.

/** Connection status for the signed-in owner's workspace. */
export async function GET() {
  const ctx = await assistantContext()
  if (!ctx) return NextResponse.json({ error: "Sign in required" }, { status: 401 })
  try {
    return NextResponse.json(await connectionStatus(ctx.supabase, ctx.workspaceId))
  } catch {
    return NextResponse.json({ error: "Could not load connection" }, { status: 500 })
  }
}

/**
 * Starts pairing: a one-time code plus a one-tap Dinghy connect link. Shown once. The link's workspace
 * hint is signed with the shared webhook secret when one is configured; without a secret the link still
 * works, Dinghy just always shows its consent page (no auto-reconnect).
 */
export async function POST() {
  const ctx = await assistantContext()
  if (!ctx) return NextResponse.json({ error: "Sign in required" }, { status: 401 })
  try {
    const pairing = await createConnectorPairing(adminClient(), { workspaceId: ctx.workspaceId, ownerId: ctx.userId })
    const connectUrl = buildDinghyConnectUrl({
      code: pairing.code,
      workspaceId: ctx.workspaceId,
      base: process.env.DINGHY_CONNECT_URL,
      secret: process.env.DINGHY_WEBHOOK_SECRET,
    })
    return NextResponse.json(
      {
        code: pairing.code,
        expiresAt: pairing.expiresAt,
        ttlSeconds: Math.round(CONNECTOR_PAIRING_TTL_MS / 1000),
        connectUrl,
      },
      { status: 201 },
    )
  } catch {
    return NextResponse.json({ error: "Could not start pairing" }, { status: 500 })
  }
}

/** Owner unlinks Dinghy from this workspace. */
export async function DELETE() {
  const ctx = await assistantContext()
  if (!ctx) return NextResponse.json({ error: "Sign in required" }, { status: 401 })
  try {
    const revoked = await revokeWorkspaceConnection(adminClient(), ctx.workspaceId)
    return NextResponse.json({ ok: true, revoked })
  } catch {
    return NextResponse.json({ error: "Could not unlink" }, { status: 500 })
  }
}
