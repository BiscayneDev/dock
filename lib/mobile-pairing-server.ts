/**
 * Supabase-backed mobile pairing store (server-only: uses the service role).
 * The consume path is the exchange_mobile_pairing RPC (migration
 * 20261104_mobile_pairings), which locks the pairing row and records failures
 * in one transaction - the atomicity the app contract relies on.
 */
import type { SupabaseClient } from "@supabase/supabase-js"
import { adminClient } from "./tenancy"
import type { ExchangeOutcome, MobileDevice, MobilePairingStore } from "./mobile-pairing.ts"

interface DeviceRow {
  id: string
  token_hash: string
  platform: string
  device_label: string | null
  created_at: string
  revoked_at: string | null
}

function toDevice(row: DeviceRow): MobileDevice {
  return {
    id: row.id,
    tokenHash: row.token_hash,
    platform: row.platform,
    deviceLabel: row.device_label ?? undefined,
    createdAt: row.created_at,
    revokedAt: row.revoked_at,
  }
}

export function supabaseMobilePairingStore(client?: SupabaseClient): MobilePairingStore {
  const db = () => client ?? adminClient()
  return {
    async createPairing(workspaceId, codeHash, expiresAt) {
      const { error } = await db()
        .from("mobile_pairings")
        .insert({ workspace_id: workspaceId, code_hash: codeHash, expires_at: expiresAt.toISOString() })
      if (error) throw new Error(`pairing create: ${error.message}`)
    },
    async consumePairing(workspaceId, codeHash, maxFailures, windowMs) {
      const { data, error } = await db().rpc("exchange_mobile_pairing", {
        p_workspace_id: workspaceId,
        p_code_hash: codeHash,
        p_max_failures: maxFailures,
        p_window_ms: windowMs,
      })
      if (error) throw new Error(`pairing exchange: ${error.message}`)
      return data as ExchangeOutcome
    },
    async insertDevice(workspaceId, device) {
      const { error } = await db().from("mobile_devices").insert({
        id: device.id,
        workspace_id: workspaceId,
        token_hash: device.tokenHash,
        platform: device.platform,
        device_label: device.deviceLabel ?? null,
      })
      if (error) throw new Error(`device insert: ${error.message}`)
    },
    async findLiveDeviceByTokenHash(tokenHash) {
      const { data, error } = await db()
        .from("mobile_devices")
        .select("*")
        .eq("token_hash", tokenHash)
        .is("revoked_at", null)
        .maybeSingle()
      if (error) throw new Error(`device lookup: ${error.message}`)
      return data ? toDevice(data as DeviceRow) : null
    },
    async listDevices(workspaceId) {
      const { data, error } = await db()
        .from("mobile_devices")
        .select("*")
        .eq("workspace_id", workspaceId)
        .order("created_at", { ascending: false })
      if (error) throw new Error(`device list: ${error.message}`)
      return (data ?? []).map((r) => toDevice(r as DeviceRow))
    },
    async revokeDevice(workspaceId, deviceId) {
      // Conditional update: only a live device in this workspace can transition.
      const { data, error } = await db()
        .from("mobile_devices")
        .update({ revoked_at: new Date().toISOString() })
        .eq("id", deviceId)
        .eq("workspace_id", workspaceId)
        .is("revoked_at", null)
        .select("id")
      if (error) throw new Error(`device revoke: ${error.message}`)
      return (data ?? []).length === 1
    },
  }
}
