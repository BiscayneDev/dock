import { NextResponse } from "next/server"
import { adminClient } from "@/lib/tenancy"
import { authenticateConnector, decideConnectorApproval } from "@/lib/connector"

export const dynamic = "force-dynamic"

interface Context {
  params: Promise<{ id: string }>
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Dinghy relays the user's yes or no on an approval this connection owns. Bearer only. */
export async function POST(request: Request, context: Context) {
  const auth = await authenticateConnector(request)
  if (!auth.ok) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { id } = await context.params
  if (!UUID.test(id)) return NextResponse.json({ error: "Approval not found" }, { status: 404 })
  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }
  try {
    const out = await decideConnectorApproval(adminClient(), auth, id.toLowerCase(), body)
    return NextResponse.json(out.body, { status: out.status })
  } catch {
    return NextResponse.json({ error: "Decision failed" }, { status: 500 })
  }
}
