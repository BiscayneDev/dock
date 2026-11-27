import { NextResponse } from "next/server";
import {
  buildListenerInsert,
  formatListenerToken,
  hashListenerToken,
  listenerView,
  newListenerSalt,
  newListenerSecret,
  supabaseListenerRepo,
  validateListenerFields,
} from "@/lib/listeners";
import { requireListenerOwner } from "./_auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/listeners — owner-only. Token material is never included; webhookUrl only exists at
 * creation time (POST), because the plaintext token is never stored.
 */
export async function GET(request: Request) {
  const auth = await requireListenerOwner(request);
  if (!auth.ok) return auth.response;

  try {
    const repo = supabaseListenerRepo(auth.ctx.client);
    const rows = await repo.list(auth.ctx.workspaceId);
    return NextResponse.json({ listeners: rows.map(listenerView) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load listeners";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * POST /api/listeners { name, targetAgentKey, runbook, filterRules }
 * -> 201 { listener, webhookToken }. webhookToken is the full path token, returned ONCE; the server
 * stores only sha256("<salt>:<secret>") with a per-row salt.
 */
export async function POST(request: Request) {
  const auth = await requireListenerOwner(request);
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Malformed JSON body" }, { status: 400 });
  }

  const validated = validateListenerFields(body, false);
  if (!validated.ok) {
    return NextResponse.json({ error: validated.reason }, { status: 400 });
  }

  const salt = newListenerSalt();
  const secret = newListenerSecret();
  const now = new Date().toISOString();

  // Insert once to learn the id, then store hash of the formatted token. The plaintext is returned
  // in this response only and never persisted.
  const repo = supabaseListenerRepo(auth.ctx.client);
  try {
    const row = await repo.insert(
      buildListenerInsert({
        workspaceId: auth.ctx.workspaceId,
        ownerId: auth.ctx.userId,
        name: validated.fields.name ?? "",
        tokenSalt: salt,
        tokenHash: hashListenerToken(salt, secret),
        filterRules: validated.fields.filterRules ?? { match: "all", rules: [] },
        targetAgentKey: validated.fields.targetAgentKey ?? "",
        runbook: validated.fields.runbook ?? "",
        now,
      }),
    );
    const webhookToken = formatListenerToken(row.id, secret);
    return NextResponse.json({ listener: listenerView(row), webhookToken }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not create listener";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
