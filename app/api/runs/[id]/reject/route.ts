import { NextResponse } from "next/server"
import { assistantContext, isUuid } from "@/lib/assistant-store"
import { decideApproval } from "@/lib/queue"

export const dynamic = "force-dynamic"

interface Context {
  params: Promise<{ id: string }>
}

/** Owner decision on a money action parked in awaiting_approval. RLS limits this to the owner's runs. */
export async function POST(_: Request, context: Context) {
  const ctx = await assistantContext()
  if (!ctx) return NextResponse.json({ error: "Sign in required" }, { status: 401 })
  const { id } = await context.params
  if (!isUuid(id)) return NextResponse.json({ error: "Run not found" }, { status: 404 })
  const result = await decideApproval(ctx.supabase, id, "reject")
  if (!result.ok) {
    const status = result.reason === "not_found" ? 404 : 409
    return NextResponse.json({ error: result.reason }, { status })
  }
  return NextResponse.json({ id: result.run.id, status: result.run.status })
}
