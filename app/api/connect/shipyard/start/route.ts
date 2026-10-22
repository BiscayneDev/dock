import { NextResponse } from "next/server";
import { assistantContext } from "@/lib/assistant-store";
import { adminClient } from "@/lib/tenancy";
import { startShipyardConnect } from "@/lib/shipyard-connect-server";

export const dynamic = "force-dynamic";

// Starts the Shipyard connect for the signed-in owner's workspace. Returns the gateway authorize URL;
// the PKCE verifier and state stay server-side, bound to this user and workspace.
export async function POST(request: Request) {
  const ctx = await assistantContext();
  if (!ctx) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const origin = new URL(request.url).origin;
  const result = await startShipyardConnect(adminClient(), {
    userId: ctx.userId,
    workspaceId: ctx.workspaceId,
    redirectUri: `${origin}/api/connect/shipyard/callback`,
  });
  if (!result.ok) {
    return NextResponse.json({ error: "Could not start the Shipyard connection" }, { status: result.error === "not_configured" ? 503 : 500 });
  }
  return NextResponse.json({ url: result.url }, { status: 201, headers: { "Cache-Control": "no-store" } });
}
