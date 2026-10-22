import { NextResponse } from "next/server"
import { currentUser, sessionClient } from "@/lib/tenancy"

export const dynamic = "force-dynamic"

export interface RunFailure {
  id: string
  agentKey: string
  error: string | null
  finishedAt: string | null
  model: string | null
  attempts: number
}

// Last 50 failed runs for the signed-in owner, for debugging (RLS: own rows only).
export async function GET() {
  const supabase = await sessionClient()
  const user = await currentUser(supabase)
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 })
  const { data, error } = await supabase
    .from("task_runs")
    .select("id, agent_key, error, finished_at, model, attempts")
    .eq("owner_id", user.id)
    .eq("status", "failed")
    .order("finished_at", { ascending: false, nullsFirst: false })
    .limit(50)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const failures: RunFailure[] = (data ?? []).map((row) => ({
    id: row.id as string,
    agentKey: (row.agent_key as string) ?? "",
    error: (row.error as string | null) ?? null,
    finishedAt: (row.finished_at as string | null) ?? null,
    model: (row.model as string | null) ?? null,
    attempts: (row.attempts as number) ?? 1,
  }))
  return NextResponse.json(failures)
}
