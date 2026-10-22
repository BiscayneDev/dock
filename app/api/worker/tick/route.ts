import { timingSafeEqual } from "crypto"
import { NextResponse } from "next/server"
import { adminClient } from "@/lib/tenancy"
import { runTick } from "@/lib/worker"

// Cloud worker tick (P2). Vercel Cron calls this every minute with `Authorization: Bearer $CRON_SECRET`.
// Works claimed runs within a time budget under maxDuration. Fails closed when CRON_SECRET is unset.
export const dynamic = "force-dynamic"
export const maxDuration = 300

const WORK_BUDGET_MS = 240_000
const DEFAULT_MAX_RUNS = 3

function authorized(request: Request): boolean | "unconfigured" {
  const secret = process.env.CRON_SECRET
  if (!secret) return "unconfigured"
  const header = request.headers.get("authorization") ?? ""
  const expected = `Bearer ${secret}`
  const a = Buffer.from(header)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

async function tick(request: Request) {
  const auth = authorized(request)
  if (auth === "unconfigured") return NextResponse.json({ error: "Worker not configured" }, { status: 503 })
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const url = new URL(request.url)
  const requested = Number(url.searchParams.get("max"))
  const maxRuns = Number.isInteger(requested) && requested >= 1 && requested <= 5 ? requested : DEFAULT_MAX_RUNS
  const workerId = `vercel-${process.env.VERCEL_DEPLOYMENT_ID ?? "local"}-${process.pid}`
  const started = Date.now()
  try {
    const summary = await runTick(adminClient(), {
      workerId,
      maxRuns,
      deadlineMs: started + WORK_BUDGET_MS,
    })
    return NextResponse.json({ ok: true, ...summary, elapsedMs: Date.now() - started })
  } catch (error) {
    const message = error instanceof Error ? error.message : "tick failed"
    return NextResponse.json({ ok: false, error: message.slice(0, 300) }, { status: 500 })
  }
}

export async function GET(request: Request) {
  return tick(request)
}

export async function POST(request: Request) {
  return tick(request)
}
