import { NextResponse } from "next/server";
import { listenerView, supabaseListenerRepo, validateListenerFields } from "@/lib/listeners";
import { requireListenerOwner } from "../_auth";

export const dynamic = "force-dynamic";

interface Context {
  params: Promise<{ id: string }>;
}

/**
 * PATCH /api/listeners/:id — partial { enabled?, filterRules?, runbook?, name? }.
 * Enabling clears the circuit-breaker pause state (paused_at/pause_reason).
 */
export async function PATCH(request: Request, context: Context) {
  const auth = await requireListenerOwner(request);
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

  if (body.enabled !== undefined && typeof body.enabled !== "boolean") {
    return NextResponse.json({ error: "enabled must be a boolean" }, { status: 400 });
  }

  const validated = validateListenerFields(
    { name: body.name, runbook: body.runbook, filterRules: body.filterRules },
    true,
  );
  if (!validated.ok) {
    return NextResponse.json({ error: validated.reason }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};
  if (validated.fields.name !== undefined) patch.name = validated.fields.name;
  if (validated.fields.runbook !== undefined) patch.runbook = validated.fields.runbook;
  if (validated.fields.filterRules !== undefined) patch.filter_rules = validated.fields.filterRules;
  if (typeof body.enabled === "boolean") {
    patch.enabled = body.enabled;
    if (body.enabled) {
      patch.paused_at = null;
      patch.pause_reason = null;
    }
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "no updatable fields supplied" }, { status: 400 });
  }

  try {
    const repo = supabaseListenerRepo(auth.ctx.client);
    const row = await repo.update(id, auth.ctx.workspaceId, patch);
    if (!row) return NextResponse.json({ error: "listener not found" }, { status: 404 });
    return NextResponse.json({ listener: listenerView(row) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not update listener";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** DELETE /api/listeners/:id -> { ok: true }. Deliveries cascade with the row. */
export async function DELETE(request: Request, context: Context) {
  const auth = await requireListenerOwner(request);
  if (!auth.ok) return auth.response;
  const { id } = await context.params;

  try {
    const repo = supabaseListenerRepo(auth.ctx.client);
    await repo.delete(id, auth.ctx.workspaceId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not delete listener";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
