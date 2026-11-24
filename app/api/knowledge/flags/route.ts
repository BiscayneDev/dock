import { NextResponse } from "next/server";
import { flagView, supabaseKnowledgeRepo } from "@/lib/knowledge-store";
import { recordKnowledgeFlag } from "@/lib/knowledge-runtime";
import { requireKnowledgeOwner } from "../_auth";

export const dynamic = "force-dynamic";

/** GET /api/knowledge/flags — the curator's input queue. Owner session only. */
export async function GET(request: Request) {
  const auth = await requireKnowledgeOwner(request);
  if (!auth.ok) return auth.response;

  try {
    const repo = supabaseKnowledgeRepo(auth.ctx.client);
    const rows = await repo.listFlags(auth.ctx.workspaceId);
    const counts = { missing: 0, wrong: 0, stale: 0 };
    for (const row of rows) counts[row.kind] += 1;
    return NextResponse.json({ flags: rows.map(flagView), counts });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load knowledge flags";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * POST /api/knowledge/flags { kind, ref?, suggestedFix?, evidence?, runId? }
 * Owner session or valid DOCK_AGENT_TOKEN (single-workspace deployments only). The payload is
 * validated by lib/knowledge-flags.ts; bad input is a 400 and never stored.
 */
export async function POST(request: Request) {
  const auth = await requireKnowledgeOwner(request);
  if (!auth.ok) return auth.response;

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Malformed JSON body" }, { status: 400 });
  }

  const runId = typeof (payload as Record<string, unknown>)?.runId === "string"
    ? ((payload as Record<string, unknown>).runId as string).slice(0, 200)
    : null;

  try {
    const result = await recordKnowledgeFlag(supabaseKnowledgeRepo(auth.ctx.client), {
      workspaceId: auth.ctx.workspaceId,
      ownerId: auth.ctx.userId,
      payload,
      runId,
    });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json({ id: result.id, flagHash: result.flagHash, duplicate: result.duplicate }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not store knowledge flag";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
