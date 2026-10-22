import { NextResponse } from "next/server"
import { adminClient } from "@/lib/tenancy"
import { authenticateConnector, revokeConnection } from "@/lib/connector"

export const dynamic = "force-dynamic"

/** Dinghy unlinks: the connector token stops working and pending approvals expire. Bearer only. */
export async function POST(request: Request) {
  const auth = await authenticateConnector(request)
  if (!auth.ok) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  try {
    await revokeConnection(adminClient(), auth.connectionId)
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: "Unlink failed" }, { status: 500 })
  }
}
