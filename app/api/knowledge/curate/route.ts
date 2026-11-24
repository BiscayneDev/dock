import { NextResponse } from "next/server";
import { supabaseKnowledgeRepo } from "@/lib/knowledge-store";
import { runCurator } from "@/lib/knowledge-runtime";
import { requireKnowledgeSession } from "../_auth";

export const dynamic = "force-dynamic";

/**
 * POST /api/knowledge/curate — owner-gated. Runs the planner over stored flags, recent run traces
 * and current documents, then persists the output as PENDING proposals. Nothing is applied here:
 * applying happens only through the proposal decision endpoint.
 */
export async function POST(request: Request) {
  const auth = await requireKnowledgeSession();
  if (!auth.ok) return auth.response;

  let maxProposals: number | undefined;
  try {
    const body = (await request.json().catch(() => ({}))) as { maxProposals?: unknown };
    if (typeof body.maxProposals === "number" && Number.isFinite(body.maxProposals)) {
      maxProposals = Math.max(1, Math.min(Math.floor(body.maxProposals), 200));
    }
  } catch {
    // No body is fine: defaults apply.
  }

  try {
    const result = await runCurator(supabaseKnowledgeRepo(auth.ctx.client), {
      workspaceId: auth.ctx.workspaceId,
      ownerId: auth.ctx.userId,
      maxProposals,
    });
    return NextResponse.json({
      created: result.created,
      conflicts: result.conflicts,
      ignored: result.ignored,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Curator run failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
