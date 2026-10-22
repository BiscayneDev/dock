import { NextResponse } from "next/server"
import { assistantContext, isUuid } from "@/lib/assistant-store"
import { getBrief } from "@/lib/briefs-store"

export const dynamic = "force-dynamic"

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await assistantContext()
  if (!ctx) return NextResponse.json({ error: "Sign in required" }, { status: 401 })
  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: "Not found" }, { status: 404 })
  const brief = await getBrief(ctx.supabase, id)
  if (!brief) return NextResponse.json({ error: "Not found" }, { status: 404 })
  return NextResponse.json(brief)
}
