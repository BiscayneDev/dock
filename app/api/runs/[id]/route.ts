import { NextResponse } from "next/server"
import { assistantContext, isUuid } from "@/lib/assistant-store"
import { getRun, listEvents } from "@/lib/queue"
import { agentTokenAuthorized } from "@/lib/agent-auth"
import { adminClient, agentTokenWorkspace } from "@/lib/tenancy"

export const dynamic = "force-dynamic"

interface Context {
  params: Promise<{ id: string }>
}

/**
 * GET /api/runs/:id — one run with its events. Accepts a browser session
 * (existing owner behavior, RLS-scoped) or a machine client via the
 * DOCK_AGENT_TOKEN bearer header (service-role read, single-workspace
 * deployments only; multi-workspace deployments reject token auth).
 */
export async function GET(request: Request, context: Context) {
  const { id } = await context.params
  if (!isUuid(id)) return NextResponse.json({ error: "Run not found" }, { status: 404 })

  const session = await assistantContext()
  let client
  let tokenWorkspaceId: string | null = null
  if (session) {
    client = session.supabase
  } else if (agentTokenAuthorized(request)) {
    const tokenWs = await agentTokenWorkspace()
    if (tokenWs === "forbidden") {
      return NextResponse.json(
        { error: "agent token auth requires a single-workspace deployment" },
        { status: 403 },
      )
    }
    tokenWorkspaceId = tokenWs.workspaceId
    client = adminClient()
  } else {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 })
  }

  try {
    const run = await getRun(client, id)
    if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 })
    if (tokenWorkspaceId && run.workspaceId !== tokenWorkspaceId) {
      return NextResponse.json({ error: "Run not found" }, { status: 404 })
    }
    return NextResponse.json({ run, events: await listEvents(client, id) })
  } catch {
    return NextResponse.json({ error: "Run lookup failed" }, { status: 500 })
  }
}
