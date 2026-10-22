#!/usr/bin/env node
// Beta access admin (service role, runs on your machine only; never deployed to the browser).
//
//   node --env-file=.env.local scripts/beta-access.mjs invite <email> [--base https://dock-harness.vercel.app] [--days 7]
//   node --env-file=.env.local scripts/beta-access.mjs grant  <email>
//   node --env-file=.env.local scripts/beta-access.mjs revoke <email>
//   node --env-file=.env.local scripts/beta-access.mjs list
//
// `invite` prints a one-time link. Opening it and signing in with that email redeems the invite.
// Tokens are never stored; only their SHA-256 is. Secrets are read from the env and never printed.

import { createClient } from "@supabase/supabase-js"
import { createHash, randomBytes } from "crypto"

const [, , command, rawEmail, ...rest] = process.argv
const flag = (name, fallback) => {
  const i = rest.indexOf(`--${name}`)
  return i >= 0 && rest[i + 1] ? rest[i + 1] : fallback
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Run with --env-file=.env.local.")
  process.exit(1)
}
const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
const who = process.env.USER ? `admin:${process.env.USER}` : "admin"

function normalize(email) {
  const e = (email ?? "").trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) {
    console.error(`Not an email address: ${email}`)
    process.exit(1)
  }
  return e
}

function fail(message, error) {
  console.error(`${message}: ${error?.message ?? "unknown error"}`)
  process.exit(1)
}

switch (command) {
  case "invite": {
    const email = normalize(rawEmail)
    const base = flag("base", "https://dock-harness.vercel.app").replace(/\/$/, "")
    const days = Number(flag("days", "7"))
    const token = randomBytes(32).toString("base64url")
    const tokenHash = createHash("sha256").update(token, "utf8").digest("hex")
    const expiresAt = new Date(Date.now() + days * 86400_000).toISOString()
    const { error } = await admin.from("invites").insert({ email, token_hash: tokenHash, invited_by: who, expires_at: expiresAt })
    if (error) fail("Could not create invite", error)
    console.log(`Invite for ${email}, valid ${days} days, one use.`)
    console.log(`${base}/login?invite=${token}`)
    break
  }
  case "grant": {
    const email = normalize(rawEmail)
    const { error } = await admin.from("beta_allowlist").upsert({ email, added_by: who, revoked_at: null }, { onConflict: "email" })
    if (error) fail("Could not grant access", error)
    console.log(`Access granted: ${email}`)
    break
  }
  case "revoke": {
    const email = normalize(rawEmail)
    const { data, error } = await admin
      .from("beta_allowlist")
      .update({ revoked_at: new Date().toISOString() })
      .eq("email", email)
      .is("revoked_at", null)
      .select("email")
    if (error) fail("Could not revoke access", error)
    console.log(data?.length ? `Access revoked: ${email}` : `No active access for ${email}`)
    break
  }
  case "list": {
    const { data, error } = await admin.from("beta_allowlist").select("email, added_at, revoked_at").order("added_at")
    if (error) fail("Could not list", error)
    for (const row of data ?? []) {
      console.log(`${row.revoked_at ? "revoked " : "active  "} ${row.email}  added ${row.added_at}`)
    }
    if (!data?.length) console.log("No beta members yet.")
    break
  }
  default:
    console.log("Usage: beta-access.mjs invite|grant|revoke|list [email] [--base URL] [--days N]")
    process.exit(command ? 1 : 0)
}
