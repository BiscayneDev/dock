import { NextResponse } from "next/server"
import { adminClient, currentUser, hashToken, newInviteToken, sessionClient } from "@/lib/tenancy"
import { MAX_INVITES_LISTED, inviteShareUrl, inviteTtlMs, normalizeInviteEmail } from "@/lib/invites"

export const dynamic = "force-dynamic"

type GateFailure = { status: 401 | 403; error: string }

/**
 * Owner-only gate, independent of proxy.ts. Fails closed: no configured owner
 * email, no session, or a non-owner email never reaches the invites table.
 */
async function ownerGate(): Promise<GateFailure | { owner: string }> {
  const configured = (process.env.DOCK_OWNER_EMAIL ?? "").trim().toLowerCase()
  if (!configured) return { status: 403, error: "Invites are not available on this workspace." }

  let email: string | null = null
  try {
    const user = await currentUser(await sessionClient())
    if (user?.email) email = user.email.toLowerCase()
  } catch {
    return { status: 401, error: "Sign in required" }
  }
  if (!email) return { status: 401, error: "Sign in required" }
  if (email !== configured) return { status: 403, error: "Only the workspace owner can manage invites." }
  return { owner: configured }
}

/** Newest invites first, without tokens or hashes. */
export async function GET() {
  const gate = await ownerGate()
  if ("status" in gate) return NextResponse.json({ error: gate.error }, { status: gate.status })

  try {
    const admin = adminClient()
    const { data, error } = await admin
      .from("invites")
      .select("id, email, created_at, expires_at, used_at")
      .order("created_at", { ascending: false })
      .limit(MAX_INVITES_LISTED)
    if (error) return NextResponse.json({ error: "Could not load invites." }, { status: 500 })
    return NextResponse.json({
      invites: (data ?? []).map((row) => ({
        id: row.id as string,
        email: row.email as string,
        createdAt: row.created_at as string,
        expiresAt: row.expires_at as string,
        usedAt: (row.used_at as string | null) ?? null,
      })),
    })
  } catch {
    return NextResponse.json({ error: "Could not load invites." }, { status: 500 })
  }
}

/**
 * Creates a one-use invite. The plaintext token appears only in this response's
 * `url`; the database stores only its SHA-256.
 *
 * Duplicate policy: while an unused, unexpired invite exists for the same email,
 * return 409 instead of issuing another link. The owner can wait for expiry and
 * retry; this avoids silently invalidating a link that may already have been sent.
 * An optional numeric `days` in the body overrides the 7-day default.
 */
export async function POST(request: Request) {
  const gate = await ownerGate()
  if ("status" in gate) return NextResponse.json({ error: gate.error }, { status: gate.status })

  const body = (await request.json().catch(() => null)) as { email?: unknown; days?: unknown } | null
  const email = normalizeInviteEmail(body?.email)
  if (!email.ok) return NextResponse.json({ error: email.error }, { status: 400 })
  const ttl = inviteTtlMs(body?.days)
  if (!ttl.ok) return NextResponse.json({ error: ttl.error }, { status: 400 })

  const token = newInviteToken()
  let origin: string
  try {
    origin = new URL(request.url).origin
  } catch {
    return NextResponse.json({ error: "Could not build the invite link." }, { status: 500 })
  }
  const link = inviteShareUrl(origin, token)
  if (!link.ok) return NextResponse.json({ error: "Could not build the invite link." }, { status: 500 })

  const now = new Date().toISOString()
  const expiresAt = new Date(Date.now() + ttl.value).toISOString()

  try {
    const admin = adminClient()
    const { data: active } = await admin
      .from("invites")
      .select("id")
      .eq("email", email.value)
      .is("used_at", null)
      .gt("expires_at", now)
      .limit(1)
    if (active && active.length > 0) {
      return NextResponse.json(
        { error: "An active invite already exists for this email. Wait for it to expire, or send the existing link." },
        { status: 409 },
      )
    }

    const { data, error } = await admin
      .from("invites")
      .insert({ email: email.value, token_hash: hashToken(token), invited_by: gate.owner, expires_at: expiresAt })
      .select("id, email, expires_at")
      .single()
    if (error || !data) return NextResponse.json({ error: "Could not create the invite." }, { status: 500 })

    return NextResponse.json(
      { invite: { id: data.id as string, email: data.email as string, expiresAt: data.expires_at as string }, url: link.value },
      { status: 201 },
    )
  } catch {
    return NextResponse.json({ error: "Could not create the invite." }, { status: 500 })
  }
}
