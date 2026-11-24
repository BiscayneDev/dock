import { NextResponse } from "next/server";
import { supabaseKnowledgeRepo } from "@/lib/knowledge-store";
import { decideProposal } from "@/lib/knowledge-runtime";
import { requireKnowledgeSession } from "../../../_auth";

export const dynamic = "force-dynamic";

interface Context {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/knowledge/proposals/:id/decision { action: 'approve'|'reject', reason? }
 *
 * The only path that writes a knowledge document. Approval applies the proposed create/patch and
 * appends an audit event; rejection records the decision and changes nothing. A proposal that is
 * no longer pending is refused with 409 { error: 'not_pending' }.
 */
export async function POST(request: Request, context: Context) {
  const auth = await requireKnowledgeSession();
  if (!auth.ok) return auth.response;

  const { id } = await context.params;

  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("bad body");
    body = parsed as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Malformed JSON body" }, { status: 400 });
  }

  if (body.action !== "approve" && body.action !== "reject") {
    return NextResponse.json({ error: "action must be 'approve' or 'reject'" }, { status: 400 });
  }
  const reason = typeof body.reason === "string" ? body.reason.slice(0, 2000) : null;

  try {
    const result = await decideProposal(supabaseKnowledgeRepo(auth.ctx.client), {
      proposalId: id,
      actorId: auth.ctx.userId,
      action: body.action,
      reason,
    });
    if (!result.ok) {
      return NextResponse.json(
        { error: result.reason, ...(result.message ? { message: result.message } : {}) },
        { status: result.httpStatus },
      );
    }
    return NextResponse.json({ proposal: result.proposal });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not decide proposal";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
