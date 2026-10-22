/**
 * Connector hooks: called from the run lifecycle (lib/queue.ts) for runs that carry connector metadata.
 * Every hook swallows its errors. A failed webhook or approval row must never change a run's outcome.
 * Runs without connector metadata are ignored, so the existing cloud and home paths are unchanged.
 */
import type { SupabaseClient } from "@supabase/supabase-js"
import { EVENT } from "@/lib/task-runs"
import { CHIEF_RUNTIME_KEY } from "@/lib/chief-key"
import { CONNECTOR_APPROVAL_TTL_MS, approvalDetailsHash, type ApprovalDetails } from "@/lib/connector-rules"
import { clipRunText, sendConnectorEvent } from "@/lib/connector-webhook"

interface ConnectorMeta {
  connection_id: string
  client_message_id: string
}

function connectorMeta(payload: Record<string, unknown>): ConnectorMeta | null {
  const c = payload.connector as Record<string, unknown> | undefined
  if (!c || typeof c.connection_id !== "string" || typeof c.client_message_id !== "string") return null
  return { connection_id: c.connection_id, client_message_id: c.client_message_id }
}

function webhookEnv() {
  return { secret: process.env.DINGHY_WEBHOOK_SECRET, url: process.env.DINGHY_WEBHOOK_URL }
}

/** Live connection for a run's metadata, or null when revoked or missing. */
async function liveConnection(admin: SupabaseClient, connectionId: string) {
  const { data, error } = await admin
    .from("dock_connections")
    .select("id, workspace_id, link_ref, revoked_at")
    .eq("id", connectionId)
    .maybeSingle()
  if (error) throw new Error(`connection: ${error.message}`)
  const row = data as { id: string; workspace_id: string; link_ref: string; revoked_at: string | null } | null
  return row && !row.revoked_at ? row : null
}

export function formatAmount(cents: number | null): string | null {
  if (cents === null || !Number.isFinite(cents)) return null
  return `$${(cents / 100).toFixed(2)}`
}

/** Named chief for the chief runtime key; other agents use their key. Used as the agent_name Dinghy shows. */
async function agentDisplayName(admin: SupabaseClient, workspaceId: string, agentKey: string): Promise<string> {
  if (agentKey !== CHIEF_RUNTIME_KEY) return agentKey
  const { data } = await admin
    .from("agents")
    .select("display_name")
    .eq("workspace_id", workspaceId)
    .eq("kind", "chief_of_staff")
    .maybeSingle()
  return ((data as { display_name?: string } | null)?.display_name ?? "Vic").slice(0, 40)
}

/**
 * Run parked in awaiting_approval: record a connector approval and tell Dinghy. Call after parkForApproval succeeds
 * and the approval_requested event is written.
 */
export async function connectorApprovalParked(admin: SupabaseClient, runId: string): Promise<void> {
  try {
    const { data: run } = await admin
      .from("task_runs")
      .select("id, workspace_id, owner_id, payload")
      .eq("id", runId)
      .maybeSingle()
    if (!run) return
    const meta = connectorMeta((run as { payload: Record<string, unknown> }).payload ?? {})
    if (!meta) return
    const conn = await liveConnection(admin, meta.connection_id)
    if (!conn) return

    const { data: ev } = await admin
      .from("task_run_events")
      .select("data")
      .eq("run_id", runId)
      .eq("kind", EVENT.approvalRequested)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()
    const d = ((ev as { data?: Record<string, unknown> } | null)?.data ?? {}) as Record<string, unknown>
    const details: ApprovalDetails = {
      actionId: String(d.actionId ?? ""),
      type: String(d.type ?? "action"),
      amountCents: typeof d.amountCents === "number" ? d.amountCents : null,
      destination: typeof d.destination === "string" ? d.destination : null,
      description: typeof d.description === "string" ? d.description : null,
    }
    if (!details.actionId) return
    const hash = approvalDetailsHash(details)
    const expiresAt = new Date(Date.now() + CONNECTOR_APPROVAL_TTL_MS).toISOString()
    const label = details.type.slice(0, 80) || "Approval"
    const action = (details.description ?? details.type).slice(0, 300)

    const { data: row, error } = await admin
      .from("connector_approvals")
      .insert({
        workspace_id: conn.workspace_id,
        owner_id: (run as { owner_id: string }).owner_id,
        connection_id: conn.id,
        run_id: runId,
        action: details,
        label,
        details_hash: hash,
        status: "pending",
        expires_at: expiresAt,
      })
      .select("id")
      .single()
    if (error || !row) throw new Error(`approval insert: ${error?.message ?? "no row"}`)

    await sendConnectorEvent({
      ...webhookEnv(),
      linkRef: conn.link_ref,
      workspaceId: conn.workspace_id,
      type: "approval.requested",
      data: {
        approval_id: (row as { id: string }).id,
        label,
        action,
        amount_text: formatAmount(details.amountCents),
        destination: details.destination,
        details_hash: hash,
        expires_at: expiresAt,
        card_url: null,
      },
    })
  } catch (err) {
    console.error("connector approval hook failed:", err instanceof Error ? err.message : String(err))
  }
}

/** Run reached a terminal state: send the outcome to Dinghy as run.update. */
export async function connectorRunFinished(
  admin: SupabaseClient,
  runId: string,
  result: { status: string; output?: string | null; error?: string | null },
): Promise<void> {
  try {
    const { data: run } = await admin
      .from("task_runs")
      .select("id, workspace_id, agent_key, payload")
      .eq("id", runId)
      .maybeSingle()
    if (!run) return
    const r = run as { workspace_id: string; agent_key: string; payload: Record<string, unknown> }
    const meta = connectorMeta(r.payload ?? {})
    if (!meta) return
    const conn = await liveConnection(admin, meta.connection_id)
    if (!conn) return

    const text =
      result.status === "succeeded"
        ? (result.output ?? "").trim() || "Done."
        : result.status === "cancelled"
          ? `Cancelled${result.error ? `: ${result.error}` : "."}`
          : `Failed${result.error ? `: ${result.error}` : "."}`
    await sendConnectorEvent({
      ...webhookEnv(),
      linkRef: conn.link_ref,
      workspaceId: conn.workspace_id,
      type: "run.update",
      data: { agent_name: await agentDisplayName(admin, r.workspace_id, r.agent_key), text: clipRunText(text) },
    })
  } catch (err) {
    console.error("connector run hook failed:", err instanceof Error ? err.message : String(err))
  }
}
