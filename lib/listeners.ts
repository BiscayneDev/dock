/**
 * Listener store (WS4): token hashing, pure row mapping and the repository behind /api/listeners.
 *
 * Hashing mirrors lib/connector-rules.ts exactly: sha256("<salt>:<secret>") with a per-row salt,
 * plaintext shown once on create. The webhook route loads the row by id from the token, then
 * compares the presented secret against the stored hash with timingSafeEqual.
 *
 * Pure functions (validation, mapping, view shaping) are import-free and node-testable; the
 * Supabase adapter is a narrow ListenerRepo implementation that route handlers and the dispatcher
 * depend on, so dispatch logic can run against an in-memory fake.
 */
import { createHash, randomBytes, timingSafeEqual } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeFilterRules, type FilterRules } from "./listener-rules.ts";

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

export const LISTENER_TOKEN_PREFIX = "docklis";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SECRET = /^[A-Za-z0-9_-]{20,100}$/;

export function newListenerSecret(): string {
  return randomBytes(32).toString("base64url");
}

export function newListenerSalt(): string {
  return randomBytes(16).toString("hex");
}

export function hashListenerToken(salt: string, secret: string): string {
  return createHash("sha256").update(`${salt}:${secret}`, "utf8").digest("hex");
}

export function formatListenerToken(listenerId: string, secret: string): string {
  return `${LISTENER_TOKEN_PREFIX}.${listenerId}.${secret}`;
}

export function parseListenerToken(token: string | null | undefined): { listenerId: string; secret: string } | null {
  if (!token || token.length > 200) return null;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== LISTENER_TOKEN_PREFIX) return null;
  const [, listenerId, secret] = parts;
  if (!UUID.test(listenerId) || !SECRET.test(secret)) return null;
  return { listenerId: listenerId.toLowerCase(), secret };
}

/** Constant-time comparison against the stored hash. Same shape as verifyConnectorSecret. */
export function verifyListenerToken(salt: string, secret: string, expectedHash: string): boolean {
  const a = Buffer.from(hashListenerToken(salt, secret), "hex");
  const b = Buffer.from(expectedHash, "hex");
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

export const DELIVERY_STATUSES = ["enqueued", "filtered", "deduped", "paused", "error"] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

export interface ListenerRow {
  id: string;
  workspace_id: string;
  owner_id: string;
  name: string;
  token_salt: string;
  token_hash: string;
  filter_rules: FilterRules;
  target_agent_key: string;
  runbook: string;
  enabled: boolean;
  trigger_count: number;
  last_triggered_at: string | null;
  paused_at: string | null;
  pause_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface ListenerDeliveryRow {
  id: string;
  listener_id: string;
  workspace_id: string;
  event_id: string;
  status: DeliveryStatus;
  detail: string | null;
  run_id: string | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Pure validation
// ---------------------------------------------------------------------------

const NAME_MAX = 120;
const RUNBOOK_MAX = 8000;
const AGENT_KEY = /^[A-Za-z0-9._:-]{1,64}$/;

export interface ListenerFields {
  name?: string;
  targetAgentKey?: string;
  runbook?: string;
  filterRules?: FilterRules;
}

export type FieldValidation =
  | { ok: true; fields: ListenerFields }
  | { ok: false; reason: string };

/**
 * Validates the mutable listener fields supplied by an owner. `partial` mode (PATCH) requires at
 * least one field; full mode (POST) requires all four. Values are trimmed/normalized.
 */
export function validateListenerFields(
  input: unknown,
  partial = false,
): FieldValidation {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, reason: "body must be an object" };
  }
  const record = input as Record<string, unknown>;
  const fields: ListenerFields = {};

  const hasAny = ["name", "targetAgentKey", "runbook", "filterRules"].some(
    (key) => record[key] !== undefined,
  );
  if (partial && !hasAny) return { ok: false, reason: "no updatable fields supplied" };

  if (record.name !== undefined || !partial) {
    if (typeof record.name !== "string") return { ok: false, reason: "name must be a string" };
    const name = record.name.trim();
    if (name.length === 0 || name.length > NAME_MAX) {
      return { ok: false, reason: `name must be 1-${NAME_MAX} characters` };
    }
    fields.name = name;
  }

  if (record.targetAgentKey !== undefined || !partial) {
    if (typeof record.targetAgentKey !== "string") {
      return { ok: false, reason: "targetAgentKey must be a string" };
    }
    const key = record.targetAgentKey.trim();
    if (!AGENT_KEY.test(key)) {
      return { ok: false, reason: "targetAgentKey must be 1-64 characters (letters, digits, . _ : -)" };
    }
    fields.targetAgentKey = key;
  }

  if (record.runbook !== undefined || !partial) {
    if (typeof record.runbook !== "string") return { ok: false, reason: "runbook must be a string" };
    if (record.runbook.trim().length === 0 || record.runbook.length > RUNBOOK_MAX) {
      return { ok: false, reason: `runbook must be 1-${RUNBOOK_MAX} characters` };
    }
    fields.runbook = record.runbook;
  }

  if (record.filterRules !== undefined || !partial) {
    const normalized = normalizeFilterRules(record.filterRules);
    if (!normalized.ok) return { ok: false, reason: normalized.reason };
    fields.filterRules = normalized.rules;
  }

  return { ok: true, fields };
}

/** Pure insert payload for a new listener (defaults applied here, never trusted from a client). */
export function buildListenerInsert(input: {
  workspaceId: string;
  ownerId: string;
  name: string;
  tokenSalt: string;
  tokenHash: string;
  filterRules: FilterRules;
  targetAgentKey: string;
  runbook: string;
  now?: string;
}): Record<string, unknown> {
  return {
    workspace_id: input.workspaceId,
    owner_id: input.ownerId,
    name: input.name,
    token_salt: input.tokenSalt,
    token_hash: input.tokenHash,
    filter_rules: input.filterRules,
    target_agent_key: input.targetAgentKey,
    runbook: input.runbook,
    enabled: true,
    trigger_count: 0,
    last_triggered_at: null,
    paused_at: null,
    pause_reason: null,
    created_at: input.now ?? new Date().toISOString(),
    updated_at: input.now ?? new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Mapping / views
// ---------------------------------------------------------------------------

export function rowToListener(raw: Record<string, unknown>): ListenerRow {
  const rulesRaw = raw.filter_rules;
  const normalized = normalizeFilterRules(rulesRaw);
  return {
    id: raw.id as string,
    workspace_id: raw.workspace_id as string,
    owner_id: raw.owner_id as string,
    name: raw.name as string,
    token_salt: raw.token_salt as string,
    token_hash: raw.token_hash as string,
    filter_rules: normalized.ok ? normalized.rules : { match: "all", rules: [] },
    target_agent_key: raw.target_agent_key as string,
    runbook: raw.runbook as string,
    enabled: Boolean(raw.enabled),
    trigger_count: Number(raw.trigger_count ?? 0),
    last_triggered_at: (raw.last_triggered_at as string | null) ?? null,
    paused_at: (raw.paused_at as string | null) ?? null,
    pause_reason: (raw.pause_reason as string | null) ?? null,
    created_at: raw.created_at as string,
    updated_at: raw.updated_at as string,
  };
}

export interface ListenerView {
  id: string;
  name: string;
  enabled: boolean;
  filterRules: FilterRules;
  targetAgentKey: string;
  runbook: string;
  createdAt: string;
  updatedAt: string;
  lastTriggeredAt: string | null;
  triggerCount: number;
  pausedAt: string | null;
  pauseReason: string | null;
}

/** API shape. Never includes the token or its salt/hash. */
export function listenerView(row: ListenerRow): ListenerView {
  return {
    id: row.id,
    name: row.name,
    enabled: row.enabled,
    filterRules: row.filter_rules,
    targetAgentKey: row.target_agent_key,
    runbook: row.runbook,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastTriggeredAt: row.last_triggered_at,
    triggerCount: row.trigger_count,
    pausedAt: row.paused_at,
    pauseReason: row.pause_reason,
  };
}

export interface DeliveryView {
  id: string;
  at: string;
  eventId: string;
  status: DeliveryStatus;
  detail: string | null;
  runId: string | null;
}

export function deliveryView(row: ListenerDeliveryRow): DeliveryView {
  return {
    id: row.id,
    at: row.created_at,
    eventId: row.event_id,
    status: row.status,
    detail: row.detail,
    runId: row.run_id,
  };
}

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

export interface ListenerRepo {
  list(workspaceId: string): Promise<ListenerRow[]>;
  /** Owner-scoped read. Null when the caller's workspace does not own it. */
  get(id: string, workspaceId: string): Promise<ListenerRow | null>;
  /** Service-role read by id (webhook token verification). */
  getById(id: string): Promise<ListenerRow | null>;
  insert(row: Record<string, unknown>): Promise<ListenerRow>;
  update(
    id: string,
    workspaceId: string,
    patch: Record<string, unknown>,
  ): Promise<ListenerRow | null>;
  delete(id: string, workspaceId: string): Promise<boolean>;
  insertDelivery(row: Omit<Record<string, unknown>, "id" | "created_at"> & {
    id?: string;
    created_at?: string;
  }): Promise<ListenerDeliveryRow>;
  listDeliveries(
    listenerId: string,
    workspaceId: string | null,
    limit?: number,
  ): Promise<ListenerDeliveryRow[]>;
  /** Count accepted enqueues at/after `sinceIso` (rate limiting). */
  countEnqueuedSince(listenerId: string, sinceIso: string): Promise<number>;
}

const LISTENER_COLUMNS = [
  "id",
  "workspace_id",
  "owner_id",
  "name",
  "token_salt",
  "token_hash",
  "filter_rules",
  "target_agent_key",
  "runbook",
  "enabled",
  "trigger_count",
  "last_triggered_at",
  "paused_at",
  "pause_reason",
  "created_at",
  "updated_at",
].join(", ");

const DELIVERY_COLUMNS = [
  "id",
  "listener_id",
  "workspace_id",
  "event_id",
  "status",
  "detail",
  "run_id",
  "created_at",
].join(", ");

function deliveryRow(raw: Record<string, unknown>): ListenerDeliveryRow {
  return {
    id: raw.id as string,
    listener_id: raw.listener_id as string,
    workspace_id: raw.workspace_id as string,
    event_id: raw.event_id as string,
    status: raw.status as DeliveryStatus,
    detail: (raw.detail as string | null) ?? null,
    run_id: (raw.run_id as string | null) ?? null,
    created_at: raw.created_at as string,
  };
}

/** Supabase-backed repository. Callers pass the session client (RLS applies) or the service role. */
export function supabaseListenerRepo(client: SupabaseClient): ListenerRepo {
  return {
    async list(workspaceId) {
      const { data, error } = await client
        .from("listeners")
        .select(LISTENER_COLUMNS)
        .eq("workspace_id", workspaceId)
        .order("created_at", { ascending: true })
        .limit(200);
      if (error) throw new Error(`listeners: ${error.message}`);
      return ((data ?? []) as unknown as Array<Record<string, unknown>>).map(rowToListener);
    },

    async get(id, workspaceId) {
      const { data, error } = await client
        .from("listeners")
        .select(LISTENER_COLUMNS)
        .eq("id", id)
        .eq("workspace_id", workspaceId)
        .maybeSingle();
      if (error) throw new Error(`listeners: ${error.message}`);
      return data ? rowToListener(data as unknown as Record<string, unknown>) : null;
    },

    async getById(id) {
      const { data, error } = await client
        .from("listeners")
        .select(LISTENER_COLUMNS)
        .eq("id", id)
        .maybeSingle();
      if (error) throw new Error(`listeners: ${error.message}`);
      return data ? rowToListener(data as unknown as Record<string, unknown>) : null;
    },

    async insert(row) {
      const { data, error } = await client
        .from("listeners")
        .insert(row)
        .select(LISTENER_COLUMNS)
        .single();
      if (error || !data) throw new Error(`listeners insert: ${error?.message ?? "failed"}`);
      return rowToListener(data as unknown as Record<string, unknown>);
    },

    async update(id, workspaceId, patch) {
      const { data, error } = await client
        .from("listeners")
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq("id", id)
        .eq("workspace_id", workspaceId)
        .select(LISTENER_COLUMNS)
        .maybeSingle();
      if (error) throw new Error(`listeners update: ${error.message}`);
      return data ? rowToListener(data as unknown as Record<string, unknown>) : null;
    },

    async delete(id, workspaceId) {
      const { error } = await client
        .from("listeners")
        .delete()
        .eq("id", id)
        .eq("workspace_id", workspaceId);
      if (error) throw new Error(`listeners delete: ${error.message}`);
      return true;
    },

    async insertDelivery(row) {
      const { data, error } = await client
        .from("listener_deliveries")
        .insert(row)
        .select(DELIVERY_COLUMNS)
        .single();
      if (error || !data) throw new Error(`listener_deliveries insert: ${error?.message ?? "failed"}`);
      return deliveryRow(data as unknown as Record<string, unknown>);
    },

    async listDeliveries(listenerId, workspaceId, limit = 50) {
      let query = client
        .from("listener_deliveries")
        .select(DELIVERY_COLUMNS)
        .eq("listener_id", listenerId)
        .order("created_at", { ascending: false })
        .limit(Math.min(Math.max(limit, 1), 500));
      if (workspaceId) query = query.eq("workspace_id", workspaceId);
      const { data, error } = await query;
      if (error) throw new Error(`listener_deliveries: ${error.message}`);
      return ((data ?? []) as unknown as Array<Record<string, unknown>>).map(deliveryRow);
    },

    async countEnqueuedSince(listenerId, sinceIso) {
      const { count, error } = await client
        .from("listener_deliveries")
        .select("id", { count: "exact", head: true })
        .eq("listener_id", listenerId)
        .eq("status", "enqueued")
        .gte("created_at", sinceIso);
      if (error) throw new Error(`listener_deliveries count: ${error.message}`);
      return count ?? 0;
    },
  };
}
