import type { SupabaseClient } from "@supabase/supabase-js"
import { decideApproval, enqueueRun } from "@/lib/queue"
import { resolveModelRef } from "@/lib/inference"
import { EVENT } from "@/lib/task-runs"
import { CHIEF_RUNTIME_KEY } from "@/lib/chief-key"
import { adminClient, DEFAULT_CHIEF_NAME } from "@/lib/tenancy"
import {
  CONNECTOR_PAIRING_TTL_MS,
  approvalDetailsHash,
  authenticateConnectorToken,
  decisionRefusal,
  formatConnectorToken,
  hashConnectorCode,
  hashConnectorSecret,
  newConnectorPairingCode,
  newConnectorSalt,
  newConnectorSecret,
  parseConnectorToken,
  type ApprovalDetails,
  type ConnectionRow,
  type ConnectorAuth,
} from "@/lib/connector-rules"

// Dinghy connector data layer (migration 0008). Every call here runs with the service role, after the caller has
// checked either the connector bearer token (connector routes) or the owner's session (setup route).

const AGENT_KEY = /^[a-z0-9_-]{1,64}$/
const MAX_MESSAGE = 8000
const DEFAULT_BUDGET_CENTS = 100
const DEDUPE_CONSTRAINT = "task_runs_connector_dedupe"

export interface ApiResult {
  status: number
  body: Record<string, unknown>
}

function fail(status: number, error: string): ApiResult {
  return { status, body: { error } }
}

/** Owner setup view: is a connection live for this workspace. Token material is never returned. */
export async function connectionStatus(client: SupabaseClient, workspaceId: string) {
  const { data, error } = await client
    .from("dock_connections")
    .select("id, created_at, last_seen_at")
    .eq("workspace_id", workspaceId)
    .is("revoked_at", null)
    .maybeSingle()
  if (error) throw new Error(`connection: ${error.message}`)
  const row = data as { id: string; created_at: string; last_seen_at: string | null } | null
  return { connected: Boolean(row), linkedAt: row?.created_at ?? null, lastSeenAt: row?.last_seen_at ?? null }
}

/** Owner creates a one-time pairing code (10 minutes). The code is shown once and never stored in plaintext. */
export async function createConnectorPairing(
  admin: SupabaseClient,
  input: { workspaceId: string; ownerId: string },
): Promise<{ code: string; expiresAt: string }> {
  const code = newConnectorPairingCode()
  const expiresAt = new Date(Date.now() + CONNECTOR_PAIRING_TTL_MS).toISOString()
  const { error } = await admin.from("connector_pairings").insert({
    code_hash: hashConnectorCode(code),
    workspace_id: input.workspaceId,
    owner_id: input.ownerId,
    expires_at: expiresAt,
  })
  if (error) throw new Error(`pairing: ${error.message}`)
  return { code, expiresAt }
}

export async function revokeWorkspaceConnection(admin: SupabaseClient, workspaceId: string): Promise<boolean> {
  const { data, error } = await admin
    .from("dock_connections")
    .select("id")
    .eq("workspace_id", workspaceId)
    .is("revoked_at", null)
  if (error) throw new Error(`connection: ${error.message}`)
  const ids = ((data ?? []) as { id: string }[]).map((r) => r.id)
  for (const id of ids) await revokeConnection(admin, id)
  return ids.length > 0
}

/** Revokes one connection and expires its pending approvals. Idempotent. */
export async function revokeConnection(admin: SupabaseClient, connectionId: string): Promise<void> {
  const now = new Date().toISOString()
  const { error: aErr } = await admin
    .from("connector_approvals")
    .update({ status: "expired", decided_at: now })
    .eq("connection_id", connectionId)
    .eq("status", "pending")
  if (aErr) throw new Error(`approvals: ${aErr.message}`)
  const { error } = await admin
    .from("dock_connections")
    .update({ revoked_at: now })
    .eq("id", connectionId)
    .is("revoked_at", null)
  if (error) throw new Error(`revoke: ${error.message}`)
}

/**
 * Exchanges a pairing code for a connector token. The token is returned once; the database keeps only the salt and
 * sha256(salt:secret). Error kinds: unknown (401), used (409), expired (410).
 */
export async function redeemConnectorPairing(
  admin: SupabaseClient,
  code: string,
  linkRef: string,
): Promise<
  | { ok: true; connectorToken: string; workspaceId: string; chiefName: string }
  | { ok: false; kind: "unknown" | "used" | "expired" }
> {
  const codeHash = hashConnectorCode(code)
  const { data: pairing, error: pErr } = await admin
    .from("connector_pairings")
    .select("used_at, expires_at")
    .eq("code_hash", codeHash)
    .maybeSingle()
  if (pErr) throw new Error(`pairing: ${pErr.message}`)
  if (!pairing) return { ok: false, kind: "unknown" }
  const p = pairing as { used_at: string | null; expires_at: string }
  if (p.used_at) return { ok: false, kind: "used" }
  if (new Date(p.expires_at).getTime() <= Date.now()) return { ok: false, kind: "expired" }

  const salt = newConnectorSalt()
  const secret = newConnectorSecret()
  const { data, error } = await admin.rpc("redeem_connector_pairing", {
    p_code_hash: codeHash,
    p_link_ref: linkRef,
    p_token_salt: salt,
    p_token_hash: hashConnectorSecret(salt, secret),
  })
  if (error) throw new Error(`pair: ${error.message}`)
  const rows = (data ?? []) as { connection_id: string; workspace_id: string; owner_id: string }[]
  // Lost a race with a concurrent redeem: the RPC consumed nothing, so report the code as used.
  if (rows.length === 0) return { ok: false, kind: "used" }
  const row = rows[0]

  const { data: chief } = await admin
    .from("agents")
    .select("display_name")
    .eq("workspace_id", row.workspace_id)
    .eq("kind", "chief_of_staff")
    .maybeSingle()
  const chiefName = ((chief as { display_name?: string } | null)?.display_name ?? DEFAULT_CHIEF_NAME).slice(0, 40)
  return {
    ok: true,
    connectorToken: formatConnectorToken(row.connection_id, secret),
    workspaceId: row.workspace_id,
    chiefName,
  }
}

/** Bearer auth for connector routes. Never falls back to a session. */
export async function authenticateConnector(request: Request): Promise<ConnectorAuth> {
  const header = request.headers.get("authorization") ?? ""
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : null
  if (!token) return { ok: false, reason: "missing" }
  const parsed = parseConnectorToken(token)
  if (!parsed) return { ok: false, reason: "malformed" }
  const { data, error } = await adminClient()
    .from("dock_connections")
    .select("id, workspace_id, owner_id, link_ref, token_salt, token_hash, revoked_at")
    .eq("id", parsed.connectionId)
    .maybeSingle()
  if (error) throw new Error(`connection: ${error.message}`)
  return authenticateConnectorToken(token, (data as ConnectionRow | null) ?? null)
}

/** POST /api/connector/runs. Dedupes on (connection, client_message_id), so a retried send creates one run. */
export async function submitConnectorRun(
  admin: SupabaseClient,
  auth: Extract<ConnectorAuth, { ok: true }>,
  body: Record<string, unknown>,
): Promise<ApiResult> {
  const message = typeof body.message === "string" ? body.message.trim() : ""
  if (!message || message.length > MAX_MESSAGE) return fail(400, `message is required (max ${MAX_MESSAGE} chars)`)
  const clientMessageId = typeof body.client_message_id === "string" ? body.client_message_id.trim() : ""
  if (!clientMessageId || clientMessageId.length > 120) return fail(400, "client_message_id is required (max 120 chars)")
  const agentKey = typeof body.agent === "string" && body.agent.trim() ? body.agent.trim() : CHIEF_RUNTIME_KEY
  if (!AGENT_KEY.test(agentKey)) return fail(400, "Invalid agent")

  const existing = await findConnectorRun(admin, auth.connectionId, clientMessageId)
  if (existing) return { status: 200, body: { run_id: existing.id, agent_name: await agentName(admin, auth, agentKey) } }

  const model = resolveModelRef(agentKey)
  if (!model) return fail(400, "No model configured for this agent")

  try {
    const run = await enqueueRun(admin, {
      workspaceId: auth.workspaceId,
      ownerId: auth.ownerId,
      projectId: null,
      agentId: null,
      agentKey,
      target: "cloud",
      prompt: message,
      model,
      budgetCents: DEFAULT_BUDGET_CENTS,
      connector: { connectionId: auth.connectionId, clientMessageId },
    })
    return { status: 201, body: { run_id: run.id, agent_name: await agentName(admin, auth, agentKey) } }
  } catch (err) {
    // A concurrent send with the same client_message_id won the dedupe index. Return that run.
    if (err instanceof Error && err.message.includes(DEDUPE_CONSTRAINT)) {
      const won = await findConnectorRun(admin, auth.connectionId, clientMessageId)
      if (won) return { status: 200, body: { run_id: won.id, agent_name: await agentName(admin, auth, agentKey) } }
    }
    throw err
  }
}

async function findConnectorRun(admin: SupabaseClient, connectionId: string, clientMessageId: string) {
  const { data, error } = await admin
    .from("task_runs")
    .select("id")
    .contains("payload", { connector: { connection_id: connectionId, client_message_id: clientMessageId } })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(`dedupe: ${error.message}`)
  return (data as { id: string } | null) ?? null
}

async function agentName(admin: SupabaseClient, auth: { workspaceId: string }, agentKey: string): Promise<string> {
  if (agentKey !== CHIEF_RUNTIME_KEY) return agentKey
  const { data } = await admin
    .from("agents")
    .select("display_name")
    .eq("workspace_id", auth.workspaceId)
    .eq("kind", "chief_of_staff")
    .maybeSingle()
  return ((data as { display_name?: string } | null)?.display_name ?? DEFAULT_CHIEF_NAME).slice(0, 40)
}

/** Details of the approval the gate currently holds for a run. Null when there is none. */
async function currentApprovalDetails(admin: SupabaseClient, runId: string): Promise<ApprovalDetails | null> {
  const { data, error } = await admin
    .from("task_run_events")
    .select("data")
    .eq("run_id", runId)
    .eq("kind", EVENT.approvalRequested)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(`events: ${error.message}`)
  const d = ((data as { data?: Record<string, unknown> } | null)?.data ?? null) as Record<string, unknown> | null
  if (!d || typeof d.actionId !== "string") return null
  return {
    actionId: d.actionId,
    type: String(d.type ?? "action"),
    amountCents: typeof d.amountCents === "number" ? d.amountCents : null,
    destination: typeof d.destination === "string" ? d.destination : null,
    description: typeof d.description === "string" ? d.description : null,
  }
}

/**
 * POST /api/connector/approvals/{id}/decision. Refused when: not owned by this connection (404), already decided (409),
 * expired (410), or the details hash no longer matches what was shown (422).
 */
export async function decideConnectorApproval(
  admin: SupabaseClient,
  auth: Extract<ConnectorAuth, { ok: true }>,
  approvalId: string,
  body: Record<string, unknown>,
): Promise<ApiResult> {
  const decision = body.decision
  if (decision !== "approve" && decision !== "reject") return fail(400, "decision must be approve or reject")
  const expected = typeof body.expected_details_hash === "string" ? body.expected_details_hash : ""
  if (!/^[0-9a-f]{64}$/.test(expected)) return fail(400, "expected_details_hash is required")

  const { data: row, error } = await admin
    .from("connector_approvals")
    .select("id, run_id, status, expires_at, details_hash")
    .eq("id", approvalId)
    .eq("connection_id", auth.connectionId)
    .maybeSingle()
  if (error) throw new Error(`approval: ${error.message}`)
  const a = row as { id: string; run_id: string | null; status: string; expires_at: string; details_hash: string } | null
  if (!a) return fail(404, "Approval not found")
  if (!a.run_id) return fail(409, "Approval is no longer attached to a run")

  const current = await currentApprovalDetails(admin, a.run_id)
  const currentHash = current ? approvalDetailsHash(current) : null
  const refusal = decisionRefusal({
    status: a.status,
    expiresAt: a.expires_at,
    now: Date.now(),
    storedHash: a.details_hash,
    expectedHash: expected,
    currentHash,
  })
  if (refusal === "expired") {
    await admin.from("connector_approvals").update({ status: "expired", decided_at: new Date().toISOString() }).eq("id", a.id).eq("status", "pending")
    return fail(410, "Approval expired")
  }
  if (refusal === "not_pending") return fail(409, "Approval already decided")
  if (refusal === "changed") return fail(422, "Approval details changed; review again")

  const outcome = await decideApproval(admin, a.run_id, decision)
  if (!outcome.ok) return fail(409, outcome.reason === "not_found" ? "Run not found" : "Approval already decided")

  const status = decision === "approve" ? "approved" : "rejected"
  await admin
    .from("connector_approvals")
    .update({ status, decided_at: new Date().toISOString() })
    .eq("id", a.id)
    .eq("status", "pending")
  return { status: 200, body: { status } }
}
