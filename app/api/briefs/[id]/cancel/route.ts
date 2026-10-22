import { NextResponse } from "next/server"
import { assistantContext, isUuid } from "@/lib/assistant-store"
import { BriefConflictError, cancelBrief } from "@/lib/briefs-store"

export const dynamic = "force-dynamic"

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await assistantContext()
  if (!ctx) return NextResponse.json({ error: "Sign in required" }, { status: 401 })
  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: "Not found" }, { status: 404 })
  try {
    const brief = await cancelBrief(ctx.supabase, { workspaceId: ctx.workspaceId, ownerId: ctx.userId }, id)
    return NextResponse.json({ brief })
  } catch (error) {
    if (error instanceof BriefConflictError) return NextResponse.json({ error: error.message }, { status: 409 })
    if (error instanceof Error && error.message === "not_found") return NextResponse.json({ error: "Not found" }, { status: 404 })
    return NextResponse.json({ error: "Cancel failed" }, { status: 500 })
  }
}
