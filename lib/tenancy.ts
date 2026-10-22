import { createHash, randomBytes } from "crypto"
import { cookies } from "next/headers"
import { createServerClient } from "@supabase/ssr"
import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import type { User } from "@supabase/supabase-js"
import { CHIEF_RUNTIME_KEY } from "@/lib/chief-key"

// Tenancy helpers (P1). Session client = the signed-in user, RLS applies.
// Admin client = service role, bypasses RLS; server-only, never sent to browsers.

export const CHIEF_ROLE = "Chief of Staff"
export const CHIEF_RUNTIME_AGENT = CHIEF_RUNTIME_KEY
export const DEFAULT_CHIEF_NAME = "Vic"
export const DEFAULT_CHIEF_PERSONA =
  "You are the user's Chief of Staff. You coordinate their projects, keep track of what matters, and answer directly. " +
  "Be concise, say when you are unsure, and ask before taking any action that spends money or changes an account."

const NAME_PATTERN = /^[A-Za-z][A-Za-z0-9 '\-]{1,23}$/
const RESERVED_NAMES = new Set(["unassigned", "system", "dock"])

export function sessionClient(): Promise<SupabaseClient> {
  return cookies().then((jar) => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    return createServerClient(url, anon, {
      cookies: {
        getAll: () => jar.getAll(),
        setAll: (items) => {
          try {
            items.forEach(({ name, value, options }) => jar.set(name, value, options))
          } catch {
            // Read-only context (server component): the proxy refreshes the session.
          }
        },
      },
    }) as unknown as SupabaseClient
  })
}

export function adminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error("Supabase service role is not configured")
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

export async function currentUser(supabase: SupabaseClient): Promise<User | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return user ?? null
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex")
}

export function newInviteToken(): string {
  return randomBytes(32).toString("base64url")
}

/** Create the app user, profile and (one) workspace for a signed-in user if missing. RLS: own rows only. */
export async function ensureWorkspace(supabase: SupabaseClient, user: User): Promise<{ id: string }> {
  const email = (user.email ?? "").toLowerCase()
  const { error: userErr } = await supabase.from("users").upsert({ id: user.id, email }, { onConflict: "id" })
  if (userErr) throw new Error(`users: ${userErr.message}`)
  await supabase.from("profiles").upsert({ user_id: user.id }, { onConflict: "user_id", ignoreDuplicates: true })
  const { data: existing } = await supabase.from("workspaces").select("id").eq("owner_id", user.id).maybeSingle()
  if (existing) return existing as { id: string }
  const { data, error } = await supabase
    .from("workspaces")
    .insert({ owner_id: user.id })
    .select("id")
    .single()
  if (error || !data) throw new Error(`workspaces: ${error?.message ?? "insert failed"}`)
  return data as { id: string }
}

export interface ChiefRecord {
  id: string
  displayName: string
  role: string
  runtimeAgent: string
}

export interface WorkspaceState {
  workspaceId: string
  building: string
  mainGoal: string
  projects: Array<{ id: string; name: string; goal: string }>
  agents: Array<{ id: string; kind: string; displayName: string; role: string; runtimeAgent: string }>
  chief: ChiefRecord | null
}

export async function loadWorkspaceState(supabase: SupabaseClient, workspaceId: string): Promise<WorkspaceState> {
  const [ws, projects, agents] = await Promise.all([
    supabase.from("workspaces").select("id, building, main_goal").eq("id", workspaceId).single(),
    supabase.from("projects").select("id, name, goal").eq("workspace_id", workspaceId).order("created_at"),
    supabase.from("agents").select("id, kind, display_name, role, runtime_agent").eq("workspace_id", workspaceId).order("created_at"),
  ])
  if (ws.error || !ws.data) throw new Error(`workspace: ${ws.error?.message ?? "not found"}`)
  const agentRows = (agents.data ?? []).map((a) => ({
    id: a.id as string,
    kind: a.kind as string,
    displayName: a.display_name as string,
    role: a.role as string,
    runtimeAgent: a.runtime_agent as string,
  }))
  const chief = agentRows.find((a) => a.kind === "chief_of_staff") ?? null
  return {
    workspaceId,
    building: (ws.data.building as string) ?? "",
    mainGoal: (ws.data.main_goal as string) ?? "",
    projects: (projects.data ?? []).map((p) => ({ id: p.id as string, name: p.name as string, goal: p.goal as string })),
    agents: agentRows,
    chief: chief ? { id: chief.id, displayName: chief.displayName, role: chief.role, runtimeAgent: chief.runtimeAgent } : null,
  }
}

/** Returns an error message, or null when the Chief of Staff name is valid. Uniqueness is enforced by the DB index too. */
export function validateAgentName(raw: string): string | null {
  const name = raw.trim()
  if (!NAME_PATTERN.test(name)) {
    return "Use 2 to 24 letters, numbers, spaces, hyphens or apostrophes, starting with a letter."
  }
  if (RESERVED_NAMES.has(name.toLowerCase())) return "That name is reserved. Pick another."
  return null
}
