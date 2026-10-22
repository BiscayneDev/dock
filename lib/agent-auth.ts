import { createHash, timingSafeEqual } from "crypto"
import { NextResponse } from "next/server"

// Shared-secret check for agent callbacks (POST /api/tasks/agent-done,
// /api/tasks/agent-spawn, /api/notify). Agents send the token either as
// `Authorization: Bearer <token>` or as `x-dock-agent-token: <token>`.
//
// Fails closed: if DOCK_AGENT_TOKEN is unset/empty, or the header is missing
// or wrong, the request is rejected with 401. The token and the header value
// are never logged or echoed back.
//
// Returns null when authorized, or a 401 response to return directly:
//   const denied = requireAgentToken(request)
//   if (denied) return denied

function unauthorized(): NextResponse {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest()
}

export function requireAgentToken(request: Request): NextResponse | null {
  const expected = (process.env.DOCK_AGENT_TOKEN ?? "").trim()
  if (!expected) return unauthorized()

  const authorization = request.headers.get("authorization") ?? ""
  const bearer = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : ""
  const provided = bearer || (request.headers.get("x-dock-agent-token") ?? "").trim()
  if (!provided) return unauthorized()

  // Compare fixed-length digests so timingSafeEqual never sees length mismatches.
  const ok = timingSafeEqual(digest(provided), digest(expected))
  return ok ? null : unauthorized()
}
