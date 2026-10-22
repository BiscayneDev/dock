import { NextResponse, type NextRequest } from "next/server"
import { createServerClient } from "@supabase/ssr"

// Routes that stay open without a browser session:
// - sign-in itself
// - agent callbacks: OpenClaw agents curl these with no login (pre-existing, see docs)
// - PayBox OAuth callback: redirected here by PayBox
// Agent callbacks (POST) are authenticated per-route with DOCK_AGENT_TOKEN (lib/agent-auth.ts).
// /api/notify is exact-match only: /api/notify/stream and /api/notify/recent are browser
// routes and must stay behind the session gate.
const PUBLIC_PATHS = ["/login", "/api/auth", "/api/tasks/agent-done", "/api/tasks/agent-spawn", "/api/paybox/connect/callback"]
const PUBLIC_EXACT_PATHS = ["/api/notify"]

function isPublic(pathname: string): boolean {
  if (PUBLIC_EXACT_PATHS.includes(pathname)) return true
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))
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

  const owner = (process.env.DOCK_OWNER_EMAIL ?? "").trim().toLowerCase()
  const allowed = !!user && !!owner && (user.email ?? "").toLowerCase() === owner

  if (allowed) return response

  if (user && !allowed) {
    // Signed in as someone else: end that session.
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
