import { NextResponse } from "next/server";
import { assistantContext } from "@/lib/assistant-store";
import { adminClient } from "@/lib/tenancy";
import { connectionView, disconnectShipyard } from "@/lib/shipyard-connect-server";

export const dynamic = "force-dynamic";

/** Connection status for the Settings card. Never includes the key. */
export async function GET() {
  const ctx = await assistantContext();
  if (!ctx) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  return NextResponse.json(await connectionView(ctx.supabase, ctx.workspaceId), { headers: { "Cache-Control": "no-store" } });
}

/** Disconnect: revoke the gateway key, then delete the local sealed key. */
export async function DELETE() {
  const ctx = await assistantContext();
  if (!ctx) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const result = await disconnectShipyard(ctx.supabase, { workspaceId: ctx.workspaceId });
  if (!result.ok) return NextResponse.json({ error: "Could not disconnect" }, { status: 500 });
  return NextResponse.json({ disconnected: true, gatewayRevoked: result.gatewayRevoked });
}
