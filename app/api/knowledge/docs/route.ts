import { NextResponse } from "next/server";
import { documentView, supabaseKnowledgeRepo } from "@/lib/knowledge-store";
import { requireKnowledgeOwner } from "../_auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/knowledge/docs?type=<skill|domain|data_access>&status=<active|stale|superseded>&q=<text>
 * Owner-only. `body` is portable OKF markdown regenerated from the stored row.
 */
export async function GET(request: Request) {
  const auth = await requireKnowledgeOwner(request);
  if (!auth.ok) return auth.response;

  const params = new URL(request.url).searchParams;
  const type = params.get("type") ?? "";
  const status = params.get("status") ?? "";
  const q = params.get("q") ?? "";

  try {
    const repo = supabaseKnowledgeRepo(auth.ctx.client);
    const rows = await repo.listDocs(auth.ctx.workspaceId, {
      type: type || undefined,
      status: status || undefined,
      q: q || undefined,
    });
    return NextResponse.json({ documents: rows.map(documentView) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load knowledge documents";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
