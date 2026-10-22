import { NextResponse } from "next/server";
import { assistantContext } from "@/lib/assistant-store";
import { adminClient } from "@/lib/tenancy";
import { finishShipyardConnect, type ConnectError } from "@/lib/shipyard-connect-server";

export const dynamic = "force-dynamic";

// Gateway redirect target. Validates state (bound to this user), exchanges the code server to server,
// seals the key, then sends the owner back to Settings. Errors carry a generic reason only.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const back = (params: string) => NextResponse.redirect(`${url.origin}/settings?${params}`, { headers: { "Cache-Control": "no-store" } });
  const ctx = await assistantContext();
  if (!ctx) return back("shipyard=error&reason=sign_in");
  const result = await finishShipyardConnect(adminClient(), {
    userId: ctx.userId,
    state: url.searchParams.get("state"),
    code: url.searchParams.get("code"),
    error: url.searchParams.get("error"),
    redirectUri: `${url.origin}/api/connect/shipyard/callback`,
  });
  if (!result.ok) {
    const reason: ConnectError | "sign_in" = result.error;
    console.warn(`shipyard connect callback failed: ${reason}`);
    return back(`shipyard=error&reason=${reason}`);
  }
  return back("shipyard=connected");
}
