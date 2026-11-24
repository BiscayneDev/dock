import { NextResponse } from "next/server";
import { proposalView, supabaseKnowledgeRepo } from "@/lib/knowledge-store";
import { requireKnowledgeSession } from "../_auth";

export const dynamic = "force-dynamic";

/** GET /api/knowledge/proposals — the human review queue. Owner session only. */
export async function GET(request: Request) {
  const auth = await requireKnowledgeSession();
  if (!auth.ok) return auth.response;

  try {
    const rows = await supabaseKnowledgeRepo(auth.ctx.client).listProposals(auth.ctx.workspaceId);
    return NextResponse.json({ proposals: rows.map(proposalView) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load proposals";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
