import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { assistantContext } from "@/lib/assistant-store";
import { agentTokenAuthorized } from "@/lib/agent-auth";
import { adminClient, agentTokenWorkspace } from "@/lib/tenancy";

// Shared gate for /api/knowledge.
//
// Reads accept either the owner's browser session (RLS-scoped) or a valid DOCK_AGENT_TOKEN from a
// machine client. Token auth stays bound to a single-workspace deployment: multi-workspace
// deployments fail closed with 403 rather than binding to the first workspace (lib/token-scoping.ts
// is unchanged). Token writes go through the service role, exactly like the worker.

export interface OwnerContext {
  client: SupabaseClient;
  workspaceId: string;
  userId: string;
  viaToken: boolean;
}

export type AuthResult = { ok: true; ctx: OwnerContext } | { ok: false; response: NextResponse };

export async function requireKnowledgeOwner(request: Request): Promise<AuthResult> {
  const session = await assistantContext();
  if (session) {
    return {
      ok: true,
      ctx: { client: session.supabase, workspaceId: session.workspaceId, userId: session.userId, viaToken: false },
    };
  }

  if (!agentTokenAuthorized(request)) {
    return { ok: false, response: NextResponse.json({ error: "Sign in required" }, { status: 401 }) };
  }

  const tokenWorkspace = await agentTokenWorkspace();
  if (tokenWorkspace === "forbidden") {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "agent token auth requires a single-workspace deployment" },
        { status: 403 },
      ),
    };
  }

  const admin = adminClient();
  const { data: workspace, error } = await admin
    .from("workspaces")
    .select("owner_id")
    .eq("id", tokenWorkspace.workspaceId)
    .maybeSingle();
  if (error || !workspace) {
    return { ok: false, response: NextResponse.json({ error: "Workspace not found" }, { status: 403 }) };
  }

  return {
    ok: true,
    ctx: {
      client: admin,
      workspaceId: tokenWorkspace.workspaceId,
      userId: workspace.owner_id as string,
      viaToken: true,
    },
  };
}

/** Owner session only: the review surfaces never accept machine tokens. */
export async function requireKnowledgeSession(): Promise<AuthResult> {
  const session = await assistantContext();
  if (!session) {
    return { ok: false, response: NextResponse.json({ error: "Sign in required" }, { status: 401 }) };
  }
  return {
    ok: true,
    ctx: { client: session.supabase, workspaceId: session.workspaceId, userId: session.userId, viaToken: false },
  };
}
