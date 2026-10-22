import { NextResponse } from "next/server"
import { currentUser, ensureWorkspace, loadWorkspaceState, sessionClient } from "@/lib/tenancy"

export const dynamic = "force-dynamic"

// Workspace state for the signed-in user (RLS: own workspace only).
export async function GET() {
  const supabase = await sessionClient()
  const user = await currentUser(supabase)
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 })
  const ws = await ensureWorkspace(supabase, user)
  const state = await loadWorkspaceState(supabase, ws.id)
  return NextResponse.json(state)
}
