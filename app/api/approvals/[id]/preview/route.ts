import { NextResponse } from "next/server"
import { assistantContext, isUuid } from "@/lib/assistant-store"
import { listEventsForRuns } from "@/lib/queue"
import { adminClient } from "@/lib/tenancy"
import { signPreviewPath } from "@/lib/approval-preview"
import { previewAccess } from "@/lib/preview-guard"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

interface Context {
  params: Promise<{ id: string }>
}

/**
 * GET /api/approvals/<runId>/preview: the owner's approval screenshot.
 * Redirects (302) to a fresh 24-hour signed URL on every request, so an expired link is never shown.
 * The signed URL is not stored. Signed out = 401. Not the owner (or no preview) = 404. Never sends a path or key.
 */
export async function GET(_: Request, context: Context) {
  const ctx = await assistantContext()
  if (!ctx) return NextResponse.json({ error: "Sign in required" }, { status: 401 })
  const { id } = await context.params
  if (!isUuid(id)) return NextResponse.json({ error: "Not found" }, { status: 404 })

  // RLS: the owner's session only sees its own runs. Another user's run comes back empty.
  const { data: run } = await ctx.supabase.from("task_runs").select("id, owner_id").eq("id", id).maybeSingle()
  const events = run ? await listEventsForRuns(ctx.supabase, [id]) : []
  const requested = [...events].reverse().find((e) => e.kind === "approval_requested")
  const access = previewAccess(
    run ? { id: run.id as string, ownerId: run.owner_id as string } : null,
    ctx.userId,
    requested?.data.screenshotPath,
  )
  if (!access.ok) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const signed = await signPreviewPath(adminClient(), access.path)
  if (!signed) return NextResponse.json({ error: "Preview unavailable" }, { status: 503 })
  return new NextResponse(null, {
    status: 302,
    headers: { Location: signed, "Cache-Control": "no-store" },
  })
}
