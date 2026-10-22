import { NextResponse } from "next/server"
import { adminClient } from "@/lib/tenancy"
import { isUuid } from "@/lib/assistant-store"
import { authenticateDevice } from "@/lib/devices"
import { completeForDevice } from "@/lib/home-runs"

export const dynamic = "force-dynamic"

interface Context {
  params: Promise<{ id: string }>
}

/** Device completes a run it holds. Transitions and the money gate are enforced server-side. */
export async function POST(request: Request, context: Context) {
  const auth = await authenticateDevice(request)
  if (!auth.ok) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { id } = await context.params
  if (!isUuid(id)) return NextResponse.json({ error: "Run not found" }, { status: 404 })
  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }
  try {
    const result = await completeForDevice(adminClient(), auth.deviceId, id, {
      status: typeof body.status === "string" ? body.status : "",
      output: typeof body.output === "string" ? body.output : null,
      error: typeof body.error === "string" ? body.error : null,
    })
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
    return NextResponse.json(result.value)
  } catch {
    return NextResponse.json({ error: "Complete failed" }, { status: 500 })
  }
}
