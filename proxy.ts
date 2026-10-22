import { NextResponse, type NextRequest } from "next/server"
import { createServerClient } from "@supabase/ssr"

// Routes that stay open without a browser session:
// - sign-in itself
// - agent callbacks: OpenClaw agents curl these with no login (pre-existing, see docs)
// - PayBox OAuth callback: redirected here by PayBox
// - Worker tick: Vercel Cron, authenticated per-route with CRON_SECRET (fails closed, app/api/worker/tick)
// Agent callbacks (POST) are authenticated per-route with DOCK_AGENT_TOKEN (lib/agent-auth.ts).
// /api/notify is exact-match only: /api/notify/stream and /api/notify/recent are browser
// routes and must stay behind the session gate.
const PUBLIC_PATHS = ["/login", "/api/auth", "/api/tasks/agent-done", "/api/tasks/agent-spawn", "/api/paybox/connect/callback", "/api/worker/tick"]
const PUBLIC_EXACT_PATHS = ["/", "/api/notify"]

// Signed-in users who are not yet allowed in may still reach these (redeeming an invite).
const SIGNED_IN_PATHS = ["/api/invites/redeem"]

// Beta members (on the allowlist, not the owner) may use only these. Conversations, tasks,
// memory and chat are still file-based and single-owner, so they stay owner-only until moved.
const BETA_PATHS = ["/onboarding", "/assistant", "/api/onboarding", "/api/workspace", "/api/invites/redeem"]

// Home-node device routes authenticate per-route with the device bearer token and never accept a session.
// Exact paths only: /api/devices (list, create) and DELETE /api/devices/[id] stay behind the session gate.
const DEVICE_BEARER_PATTERNS = [
  /^\/api\/devices\/(heartbeat|claim|infer|pair)$/,
  /^\/api\/runs\/[^/]+\/(events|complete)$/,
]

// Dinghy connector routes authenticate per-route: pair with the one-time code, the rest with the connector bearer token.
// Exact paths only. /api/connector/setup (the owner's Settings card) stays behind the session gate.
const CONNECTOR_BEARER_PATTERNS = [
  /^\/api\/connector\/(pair|unlink|runs)$/,
  /^\/api\/connector\/approvals\/[^/]+\/decision$/,
]

function isPublic(pathname: string): boolean {
  if (PUBLIC_EXACT_PATHS.includes(pathname)) return true
  if (DEVICE_BEARER_PATTERNS.some((re) => re.test(pathname))) return true
  if (CONNECTOR_BEARER_PATTERNS.some((re) => re.test(pathname))) return true
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))
}

function matches(pathname: string, list: string[]): boolean {
  return list.some((p) => pathname === p || pathname.startsWith(`${p}/`))
}

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl
  const response = NextResponse.next({ request })

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anon) {
    // Fail closed: without auth configured, nothing outside the public list is served.
    if (isPublic(pathname)) return response
    return NextResponse.json({ error: "Sign-in is not configured" }, { status: 503 })
  }

  const supabase = createServerClient(url, anon, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet) => {
        cookiesToSet.forEach(({ name, value, options }) => {
          request.cookies.set(name, value)
          response.cookies.set(name, value, options)
        })
      },
    },
  })

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (isPublic(pathname)) return response

  // Admin override: DOCK_OWNER_EMAIL has full access.
  const owner = (process.env.DOCK_OWNER_EMAIL ?? "").trim().toLowerCase()
  const isOwner = !!user && !!owner && (user.email ?? "").toLowerCase() === owner
  if (isOwner) return response

  if (user && matches(pathname, SIGNED_IN_PATHS)) return response

  // Beta members: on the allowlist (checked by RPC, RLS-safe), limited to BETA_PATHS.
  if (user) {
    const { data: isBeta } = await supabase.rpc("is_beta_member")
    if (isBeta === true) {
      if (matches(pathname, BETA_PATHS)) return response
      if (pathname.startsWith("/api/")) {
        return NextResponse.json({ error: "Not available on this account" }, { status: 403 })
      }
      return NextResponse.redirect(new URL("/onboarding", request.url))
    }
    // Signed in as someone who is not allowed: end that session.
    await supabase.auth.signOut()
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 })
  }
  const login = new URL("/login", request.url)
  login.searchParams.set("next", `${pathname}${search}`)
  return NextResponse.redirect(login)
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|fonts|.*\\.(?:png|jpg|jpeg|svg|webp|ico|mp4|woff2?)$).*)"],
}
