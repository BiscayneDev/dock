import { NextResponse } from "next/server"
import { adminClient } from "@/lib/tenancy"
import { redeemConnectorPairing } from "@/lib/connector"
import { normalizeConnectorCode } from "@/lib/connector-rules"

export const dynamic = "force-dynamic"

/**
 * Exchanges a one-time pairing code for a connector token. No session: the code is the secret. Bearer-allowlisted in
 * proxy.ts. 401 unknown code, 409 already used, 410 expired. The token is returned once and never stored in plaintext.
 */
export async function POST(request: Request) {
  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }
  const code = normalizeConnectorCode(body.code)
  const linkRef = typeof body.link_ref === "string" ? body.link_ref.trim() : ""
  if (!code || linkRef.length < 16 || linkRef.length > 128) {
    return NextResponse.json({ error: "Invalid pairing code" }, { status: 401 })
  }
  try {
    const out = await redeemConnectorPairing(adminClient(), code, linkRef)
    if (!out.ok) {
      if (out.kind === "expired") return NextResponse.json({ error: "Pairing code expired" }, { status: 410 })
      if (out.kind === "used") return NextResponse.json({ error: "Pairing code already used" }, { status: 409 })
      return NextResponse.json({ error: "Pairing code is invalid" }, { status: 401 })
    }
    return NextResponse.json(
      { connector_token: out.connectorToken, workspace_id: out.workspaceId, chief_name: out.chiefName },
      { status: 200 },
    )
  } catch {
    return NextResponse.json({ error: "Pairing failed" }, { status: 500 })
  }
}
