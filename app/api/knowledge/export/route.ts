import { NextResponse } from "next/server";
import { supabaseKnowledgeRepo } from "@/lib/knowledge-store";
import { buildKnowledgeBundle } from "@/lib/knowledge-runtime";
import { requireKnowledgeOwner } from "../_auth";

export const dynamic = "force-dynamic";

/** GET /api/knowledge/export — portable OKF-shaped bundle (index.md + one file per doc + log.md). */
export async function GET(request: Request) {
  const auth = await requireKnowledgeOwner(request);
  if (!auth.ok) return auth.response;

  try {
    const bundle = await buildKnowledgeBundle(supabaseKnowledgeRepo(auth.ctx.client), auth.ctx.workspaceId);
    return NextResponse.json({ bundle });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not export knowledge";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
