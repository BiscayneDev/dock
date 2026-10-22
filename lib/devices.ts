import type { SupabaseClient } from "@supabase/supabase-js"
import { adminClient } from "@/lib/tenancy"
import { DEFAULT_LEASE_SECONDS, type TaskRun } from "@/lib/queue"
import {
  authenticateDeviceToken,
  deviceWorkerId,
  formatDeviceToken,
  hashDeviceSecret,
  hashPairingCode,
  isDeviceOnline,
  newDeviceSalt,
  newDeviceSecret,
  newPairingCode,
  PAIRING_TTL_MS,
  parseDeviceToken,
  type DeviceAuth,
  type DeviceRow,
} from "@/lib/device-rules"

// Home node data layer (migration 0006). Owner calls pass the session client (RLS applies).
// Device calls pass the service-role client, after authenticateDeviceToken has checked the bearer token.

export interface DeviceView {
  id: string
  name: string
  paired: boolean
  online: boolean
  lastSeenAt: string | null
  createdAt: string
}

const DEVICE_COLUMNS = "id, workspace_id, owner_id, name, token_salt, token_hash, revoked_at, last_seen_at, created_at"

function toView(r: Record<string, unknown>): DeviceView {
  const lastSeenAt = (r.last_seen_at as string | null) ?? null
  return {
    id: r.id as string,
    name: r.name as string,
    paired: Boolean(r.token_hash),
    online: isDeviceOnline(lastSeenAt),
    lastSeenAt,
    createdAt: r.created_at as string,
  }
}

/** Active (not revoked) devices for the signed-in owner, newest first. */
export async function listDevices(supabase: SupabaseClient): Promise<DeviceView[]> {
  const { data, error } = await supabase
    .from("devices")
    .select(DEVICE_COLUMNS)
    .is("revoked_at", null)
    .order("created_at", { ascending: false })
    .limit(50)
  if (error) throw new Error(`devices: ${error.message}`)
  return (data ?? []).map((r) => toView(r as Record<string, unknown>))
}

/** True when any active, paired device of this owner has a fresh heartbeat. */
export async function ownerHasOnlineDevice(supabase: SupabaseClient): Promise<boolean> {
  const devices = await listDevices(supabase)
  return devices.some((d) => d.paired && d.online)
}

/** Owner creates a device slot and a one-time pairing code (10 minutes). The device is not usable until paired. */
export async function createPairing(
  supabase: SupabaseClient,
  input: { workspaceId: string; ownerId: string; name: string },
): Promise<{ deviceId: string; code: string; expiresAt: string }> {
  const { data, error } = await supabase
    .from("devices")
    .insert({ workspace_id: input.workspaceId, owner_id: input.ownerId, name: input.name })
    .select("id")
    .single()
  if (error || !data) throw new Error(`device: ${error?.message ?? "insert failed"}`)
  const deviceId = (data as { id: string }).id
  const code = newPairingCode()
  const expiresAt = new Date(Date.now() + PAIRING_TTL_MS).toISOString()
  const { error: pErr } = await supabase
    .from("device_pairings")
    .insert({ code_hash: hashPairingCode(code), device_id: deviceId, expires_at: expiresAt })
  if (pErr) throw new Error(`pairing: ${pErr.message}`)
  return { deviceId, code, expiresAt }
}

/**
 * Exchanges a pairing code for a long-lived device token. Service role only. The plaintext token is returned
 * once and never stored; the database keeps the salt and sha256(salt:secret).
 */
export async function redeemPairing(
  admin: SupabaseClient,
  code: string,
): Promise<{ deviceId: string; deviceToken: string } | null> {
  const salt = newDeviceSalt()
  const secret = newDeviceSecret()
  // The device id is unknown until the redeem call returns. The hash binds to the salt and secret, not the id,
  // so the token can be formed afterwards.
  const { data, error } = await admin.rpc("redeem_device_pairing", {
    p_code_hash: hashPairingCode(code),
    p_token_salt: salt,
    p_token_hash: hashDeviceSecret(salt, secret),
  })
  if (error) throw new Error(`pair: ${error.message}`)
  const deviceId = typeof data === "string" ? data : null
  if (!deviceId) return null
  return { deviceId, deviceToken: formatDeviceToken(deviceId, secret) }
}

/** Loads a device row with the service role. Null when missing. */
export async function loadDeviceRow(admin: SupabaseClient, deviceId: string): Promise<DeviceRow | null> {
  const { data, error } = await admin.from("devices").select(DEVICE_COLUMNS).eq("id", deviceId).maybeSingle()
  if (error) throw new Error(`device: ${error.message}`)
  return data ? (data as unknown as DeviceRow) : null
}

/** Bearer-token auth for device endpoints. Never falls back to a session. */
export async function authenticateDevice(request: Request): Promise<DeviceAuth> {
  const header = request.headers.get("authorization") ?? ""
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : null
  const parsed = parseDeviceToken(token)
  if (!parsed) return authenticateDeviceToken(token, null)
  const row = await loadDeviceRow(adminClient(), parsed.deviceId)
  return authenticateDeviceToken(token, row)
}

/**
 * Heartbeat: records last_seen_at and extends the leases this device holds, so a live device keeps its runs.
 * A device that stops heartbeating lets its leases expire; the existing recovery then requeues the runs.
 */
export async function touchDevice(admin: SupabaseClient, deviceId: string, leaseSeconds = DEFAULT_LEASE_SECONDS) {
  const now = new Date()
  const until = new Date(now.getTime() + leaseSeconds * 1000).toISOString()
  const { error } = await admin
    .from("devices")
    .update({ last_seen_at: now.toISOString() })
    .eq("id", deviceId)
    .is("revoked_at", null)
  if (error) throw new Error(`heartbeat: ${error.message}`)
  const { error: lErr } = await admin
    .from("task_runs")
    .update({ lease_until: until, updated_at: now.toISOString() })
    .eq("lease_owner", deviceWorkerId(deviceId))
    .in("status", ["leased", "running"])
  if (lErr) throw new Error(`lease: ${lErr.message}`)
}

/** Claims the next queued home run for this device. Null when nothing is queued or the device is stale. */
export async function claimHomeRun(admin: SupabaseClient, deviceId: string): Promise<TaskRun | null> {
  const { data, error } = await admin.rpc("claim_home_run", { p_device_id: deviceId, p_lease_seconds: DEFAULT_LEASE_SECONDS })
  if (error) throw new Error(`claim: ${error.message}`)
  const rows = (data ?? []) as Record<string, unknown>[]
  if (rows.length === 0) return null
  const r = rows[0]
  return {
    id: r.id as string,
    workspaceId: r.workspace_id as string,
    ownerId: r.owner_id as string,
    projectId: (r.project_id as string | null) ?? null,
    agentId: (r.agent_id as string | null) ?? null,
    agentKey: r.agent_key as string,
    target: r.target as TaskRun["target"],
    status: r.status as TaskRun["status"],
    payload: (r.payload as Record<string, unknown>) ?? {},
    model: (r.model as string | null) ?? null,
    budgetCents: r.budget_cents as number,
    spentCents: r.spent_cents as number,
    leaseOwner: (r.lease_owner as string | null) ?? null,
    leaseUntil: (r.lease_until as string | null) ?? null,
    attempts: r.attempts as number,
    maxAttempts: r.max_attempts as number,
    error: (r.error as string | null) ?? null,
    output: (r.output as string | null) ?? null,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
    startedAt: (r.started_at as string | null) ?? null,
    finishedAt: (r.finished_at as string | null) ?? null,
  }
}

/** Loads a run only if this device holds its lease. Null otherwise: a device cannot touch another device's run. */
export async function heldRun(admin: SupabaseClient, runId: string, deviceId: string): Promise<Record<string, unknown> | null> {
  const { data, error } = await admin
    .from("task_runs")
    .select("*")
    .eq("id", runId)
    .eq("lease_owner", deviceWorkerId(deviceId))
    .in("status", ["leased", "running"])
    .maybeSingle()
  if (error) throw new Error(`run: ${error.message}`)
  return (data as Record<string, unknown> | null) ?? null
}

/** Owner revokes a device: the row is kept for audit, its token stops working, and its leased runs are requeued. */
export async function revokeDevice(
  supabase: SupabaseClient,
  admin: SupabaseClient,
  deviceId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("devices")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", deviceId)
    .is("revoked_at", null)
    .select("id")
  if (error) throw new Error(`revoke: ${error.message}`)
  if (!data || data.length !== 1) return false
  const worker = deviceWorkerId(deviceId)
  const { data: held } = await admin
    .from("task_runs")
    .update({ status: "queued", lease_owner: null, lease_until: null, updated_at: new Date().toISOString() })
    .eq("lease_owner", worker)
    .in("status", ["leased", "running"])
    .select("id")
  for (const row of (held ?? []) as { id: string }[]) {
    await admin.from("task_run_events").insert({ run_id: row.id, kind: "lease_expired", data: { reason: "device_revoked", previous_worker: worker } })
  }
  return true
}
