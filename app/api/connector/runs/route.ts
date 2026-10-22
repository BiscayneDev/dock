import { NextResponse } from "next/server"
import { adminClient } from "@/lib/tenancy"
import { authenticateConnector, submitConnectorRun } from "@/lib/connector"

export const dynamic = "force-dynamic"

/** Dinghy asks for a run in the connection's workspace. 201 new, 200 when client_message_id was already seen. Bearer only. */
export async function POST(request: Request) {
  const auth = await authenticateConnector(request)
  if (!auth.ok) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }
  try {
    const out = await submitConnectorRun(adminClient(), auth, body)
    return NextResponse.json(out.body, { status: out.status })
  } catch {
    return NextResponse.json({ error: "Could not queue run" }, { status: 500 })
  }
}
