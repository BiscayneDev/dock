// Server-only: Shipyard connect orchestration for Dock (start, callback, revoke, per-workspace key lookup).
// Uses the admin client for state rows and the sealed key. Never returns a key to the browser.
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildAuthorizeUrl,
  decryptSecret,
  encryptSecret,
  generateState,
  generateVerifier,
  pkceChallenge,
  redactForLog,
  SHIPYARD_CLIENT_ID,
  SHIPYARD_SCOPES,
} from "./shipyard-connect.ts";

export const SHIPYARD_STATE_TTL_MS = 10 * 60_000;
export const DEFAULT_SHIPYARD_BUDGET_USD = 10;

export type ConnectError =
  | "not_configured"
  | "bad_state"
  | "state_expired"
  | "user_mismatch"
  | "exchange_failed"
  | "store_failed"
  | "denied";

export function inferenceOrigin(env: NodeJS.ProcessEnv = process.env): string {
  return (env.SHIPYARD_INFERENCE_ORIGIN?.trim() || "https://shipyard-inference.vercel.app").replace(/\/+$/, "");
}

function encKey(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return env.SHIPYARD_CONNECT_ENC_KEY?.trim() || undefined;
}

/** Stores PKCE verifier (sealed) and state bound to user + workspace; returns the gateway authorize URL. */
export async function startShipyardConnect(
  admin: SupabaseClient,
  p: { userId: string; workspaceId: string; redirectUri: string; now?: number },
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ ok: true; url: string } | { ok: false; error: ConnectError }> {
  const key = encKey(env);
  if (!key) return { ok: false, error: "not_configured" };
  const verifier = generateVerifier();
  const state = generateState();
  const now = p.now ?? Date.now();
  const { error } = await admin.from("workspace_shipyard_connect_states").insert({
    state,
    owner: p.userId,
    workspace_id: p.workspaceId,
    verifier_sealed: encryptSecret(verifier, key),
    expires_at: new Date(now + SHIPYARD_STATE_TTL_MS).toISOString(),
  });
  if (error) return { ok: false, error: "store_failed" };
  const url = buildAuthorizeUrl(inferenceOrigin(env), {
    redirectUri: p.redirectUri,
    state,
    challenge: pkceChallenge(verifier),
    workspace: p.workspaceId,
  });
  return { ok: true, url };
}

/** Validates state, exchanges the code (verifier + client secret, server to server), seals the key, stores it. */
export async function finishShipyardConnect(
  admin: SupabaseClient,
  p: { userId: string; state: string | null; code: string | null; error?: string | null; redirectUri: string; now?: number },
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: true; workspaceId: string } | { ok: false; error: ConnectError }> {
  const now = p.now ?? Date.now();
  if (p.error) return { ok: false, error: "denied" };
  const key = encKey(env);
  const secret = env.SHIPYARD_CLIENT_SECRET?.trim();
  if (!key || !secret) return { ok: false, error: "not_configured" };
  if (!p.state || !/^[A-Za-z0-9_-]{16,128}$/.test(p.state) || !p.code) return { ok: false, error: "bad_state" };

  // Single use: delete the row and read it back in one step.
  const { data: rows, error: readErr } = await admin
    .from("workspace_shipyard_connect_states")
    .delete()
    .eq("state", p.state)
    .select("owner, workspace_id, verifier_sealed, expires_at");
  if (readErr) return { ok: false, error: "store_failed" };
  const row = (rows ?? [])[0] as { owner: string; workspace_id: string; verifier_sealed: string; expires_at: string } | undefined;
  if (!row) return { ok: false, error: "bad_state" };
  if (new Date(row.expires_at).getTime() < now) return { ok: false, error: "state_expired" };
  if (row.owner !== p.userId) return { ok: false, error: "user_mismatch" };

  let verifier: string;
  try {
    verifier = decryptSecret(row.verifier_sealed, key);
  } catch {
    return { ok: false, error: "bad_state" };
  }

  let body: Record<string, unknown>;
  try {
    const res = await fetchImpl(`${inferenceOrigin(env)}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: p.code,
        code_verifier: verifier,
        client_id: SHIPYARD_CLIENT_ID,
        client_secret: secret,
        redirect_uri: p.redirectUri,
      }),
      cache: "no-store",
    });
    body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok || typeof body.access_token !== "string" || !body.access_token) {
      console.warn(redactForLog(`shipyard connect: token exchange refused (${res.status}) ${String(body.error ?? "")}`));
      return { ok: false, error: "exchange_failed" };
    }
  } catch (err) {
    console.warn(redactForLog(`shipyard connect: token exchange error ${err instanceof Error ? err.message : "unknown"}`));
    return { ok: false, error: "exchange_failed" };
  }

  const token = body.access_token as string;
  const keyId = typeof body.key_id === "string" ? body.key_id : "";
  const scopes = typeof body.scope === "string" ? body.scope.split(" ").filter(Boolean) : [...SHIPYARD_SCOPES];
  const budget = typeof body.budget_usd === "number" ? body.budget_usd : DEFAULT_SHIPYARD_BUDGET_USD;

  // One active connection per workspace: retire the old one, then insert the new one.
  const { error: revokeErr } = await admin
    .from("workspace_shipyard_connections")
    .update({ revoked_at: new Date(now).toISOString(), encrypted_key: "" })
    .eq("workspace_id", row.workspace_id)
    .is("revoked_at", null);
  const { error: insErr } = revokeErr
    ? { error: revokeErr }
    : await admin.from("workspace_shipyard_connections").insert({
        workspace_id: row.workspace_id,
        owner: row.owner,
        key_id: keyId,
        encrypted_key: encryptSecret(token, key),
        scopes,
        budget_usd: budget,
      });
  if (insErr) {
    console.warn(redactForLog(`shipyard connect: store failed ${insErr.message}`));
    return { ok: false, error: "store_failed" };
  }
  return { ok: true, workspaceId: row.workspace_id };
}

export interface ConnectionView {
  connected: boolean;
  keyId?: string;
  scopes?: string[];
  budgetUsd?: number;
  createdAt?: string;
}

export async function connectionView(supabase: SupabaseClient, workspaceId: string): Promise<ConnectionView> {
  const { data } = await supabase
    .from("workspace_shipyard_connections")
    .select("key_id, scopes, budget_usd, created_at")
    .eq("workspace_id", workspaceId)
    .is("revoked_at", null)
    .maybeSingle();
  if (!data) return { connected: false };
  const d = data as { key_id: string; scopes: string[]; budget_usd: number; created_at: string };
  return { connected: true, keyId: d.key_id, scopes: d.scopes, budgetUsd: Number(d.budget_usd), createdAt: d.created_at };
}

/** Revokes the gateway key, then deletes the local sealed key. Gateway failure still retires the local key. */
export async function disconnectShipyard(
  supabase: SupabaseClient,
  p: { workspaceId: string },
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: boolean; gatewayRevoked: boolean }> {
  const { data } = await supabase
    .from("workspace_shipyard_connections")
    .select("id, encrypted_key")
    .eq("workspace_id", p.workspaceId)
    .is("revoked_at", null)
    .maybeSingle();
  if (!data) return { ok: true, gatewayRevoked: false };
  const row = data as { id: string; encrypted_key: string };
  const key = encKey(env);
  let gatewayRevoked = false;
  if (key && row.encrypted_key) {
    try {
      const token = decryptSecret(row.encrypted_key, key);
      const res = await fetchImpl(`${inferenceOrigin(env)}/oauth/revoke`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token, client_id: SHIPYARD_CLIENT_ID }),
        cache: "no-store",
      });
      gatewayRevoked = res.ok;
    } catch {
      gatewayRevoked = false;
    }
  }
  const { error } = await supabase
    .from("workspace_shipyard_connections")
    .update({ revoked_at: new Date().toISOString(), encrypted_key: "" })
    .eq("id", row.id);
  return { ok: !error, gatewayRevoked };
}

/**
 * Route-preview key for a workspace: its own connection when one exists, else the global key.
 * A connection that cannot be opened is an error, not a silent fallback to the global key.
 */
export async function routeKeyForWorkspace(
  admin: SupabaseClient,
  workspaceId: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ source: "connection" | "global"; key: string } | { source: "none" } | { source: "error" }> {
  const { data } = await admin
    .from("workspace_shipyard_connections")
    .select("encrypted_key")
    .eq("workspace_id", workspaceId)
    .is("revoked_at", null)
    .maybeSingle();
  if (data) {
    const key = encKey(env);
    const blob = (data as { encrypted_key: string }).encrypted_key;
    if (!key || !blob) return { source: "error" };
    try {
      return { source: "connection", key: decryptSecret(blob, key) };
    } catch {
      return { source: "error" };
    }
  }
  const global = env.SHIPYARD_ROUTE_KEY?.trim();
  return global ? { source: "global", key: global } : { source: "none" };
}
