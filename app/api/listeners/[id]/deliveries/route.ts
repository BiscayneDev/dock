import { NextResponse } from "next/server";
import { deliveryView, supabaseListenerRepo } from "@/lib/listeners";
import { requireListenerOwner } from "../../_auth";

export const dynamic = "force-dynamic";

interface Context {
  params: Promise<{ id: string }>;
}

/** GET /api/listeners/:id/deliveries?limit=50 — newest-first audit of inbound deliveries. */
export async function GET(request: Request, context: Context) {
  const auth = await requireListenerOwner(request);
  if (!auth.ok) return auth.response;
  const { id } = await context.params;

  const params = new URL(request.url).searchParams;
  const rawLimit = Number(params.get("limit") ?? "50");
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(Math.floor(rawLimit), 1), 200) : 50;

  try {
    const repo = supabaseListenerRepo(auth.ctx.client);
    const listener = await repo.get(id, auth.ctx.workspaceId);
    if (!listener) return NextResponse.json({ error: "listener not found" }, { status: 404 });
    const rows = await repo.listDeliveries(id, auth.ctx.workspaceId, limit);
    const deliveries = rows.map(deliveryView);
    return NextResponse.json({ deliveries });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load deliveries";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
