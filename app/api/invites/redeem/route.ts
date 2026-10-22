import { NextResponse } from "next/server"
import { adminClient, currentUser, ensureWorkspace, hashToken, sessionClient } from "@/lib/tenancy"

export const dynamic = "force-dynamic"

// Redeems an invite token for the signed-in user. The token must match the user's email.
// Public to the proxy only for signed-in users (see SIGNED_IN_PATHS in proxy.ts).
export async function POST(request: Request) {
  const supabase = await sessionClient()
  const user = await currentUser(supabase)
  if (!user || !user.email) return NextResponse.json({ error: "Not signed in" }, { status: 401 })

  const body = (await request.json().catch(() => null)) as { token?: unknown } | null
  const token = typeof body?.token === "string" ? body.token.trim() : ""
  if (!token || token.length > 200) return NextResponse.json({ error: "Invite link is not valid." }, { status: 400 })

  const email = user.email.toLowerCase()
  const admin = adminClient()
  const { data: invite } = await admin
    .from("invites")
    .select("id, email, used_at, expires_at")
    .eq("token_hash", hashToken(token))
    .maybeSingle()

  const expired = invite ? new Date(invite.expires_at as string).getTime() <= Date.now() : true
  if (!invite || invite.email !== email || invite.used_at || expired) {
    return NextResponse.json({ error: "This invite is not valid for this account, or has expired." }, { status: 403 })
  }

  // Mark used first, only if still unused (guards against double redemption).
  const { data: claimed } = await admin
    .from("invites")
    .update({ used_at: new Date().toISOString() })
    .eq("id", invite.id)
    .is("used_at", null)
    .select("id")
  if (!claimed || claimed.length === 0) {
    return NextResponse.json({ error: "This invite has already been used." }, { status: 403 })
  }

  const { error } = await admin
    .from("beta_allowlist")
    .upsert({ email, added_by: "invite", revoked_at: null }, { onConflict: "email" })
  if (error) return NextResponse.json({ error: "Could not activate your account." }, { status: 500 })

  await ensureWorkspace(supabase, user)
  return NextResponse.json({ ok: true })
}
