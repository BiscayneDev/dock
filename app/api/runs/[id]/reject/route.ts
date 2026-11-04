import { NextResponse } from "next/server"
import { assistantContext, isUuid } from "@/lib/assistant-store"
import { mobileTokenHas, mobileTokenAuthorized } from "@/lib/mobile-auth"
import { resolveMobileOwnerContext } from "@/lib/mobile-auth-server"
import { decideApproval } from "@/lib/queue"

export const dynamic = "force-dynamic"

interface Context {
  params: Promise<{ id: string }>
}

/** Owner decision on a money action parked in awaiting_approval. RLS limits this to the owner's runs. */
export async function POST(request: Request, context: Context) {
  let ctx = await assistantContext()
  if (!ctx && mobileTokenAuthorized(request) && mobileTokenHas("runs:decide")) {
    const mobileCtx = await resolveMobileOwnerContext(request)
    if (mobileCtx && !("forbidden" in mobileCtx)) ctx = mobileCtx
  }
  if (!ctx) return NextResponse.json({ error: "Sign in required" }, { status: 401 })
  const { id } = await context.params
  if (!isUuid(id)) return NextResponse.json({ error: "Run not found" }, { status: 404 })
  const result = await decideApproval(ctx.supabase, id, "reject", ctx.userId)
  if (!result.ok) {
    const status = result.reason === "not_found" ? 404 : 409
    return NextResponse.json({ error: result.reason }, { status })
  }
  return NextResponse.json({ id: result.run.id, status: result.run.status })
}
