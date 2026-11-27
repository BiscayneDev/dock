import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { addEvent, enqueueRun } from "@/lib/queue";
import { adminClient } from "@/lib/tenancy";
import { resolveAgentExplore } from "@/lib/agent-flags";
import { supabaseListenerRepo } from "@/lib/listeners";
import {
  LISTENER_RUN_MODEL,
  receiveListenerEvent,
  type DispatchDeps,
} from "@/lib/listener-dispatch";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BODY_BYTES = 256 * 1024;

interface Context {
  params: Promise<{ token: string }>;
}

/**
 * POST /api/webhooks/:token — unauthenticated ingress authenticated by the high-entropy token in
 * the URL (verified against a salted sha256 hash with timingSafeEqual). Any JSON body is accepted;
 * an optional Idempotency-Key header dedupes inside the replay window.
 *
 * Responds { status: 'enqueued'|'filtered'|'deduped'|'paused'|'error', runId?, reason? }.
 */
export async function POST(request: Request, context: Context) {
  const { token } = await context.params;

  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return NextResponse.json({ status: "error", reason: "unreadable_body" }, { status: 400 });
  }
  if (raw.length > MAX_BODY_BYTES) {
    return NextResponse.json({ status: "error", reason: "body_too_large" }, { status: 413 });
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ status: "error", reason: "invalid_json" }, { status: 400 });
  }

  let admin;
  try {
    admin = adminClient();
  } catch {
    return NextResponse.json({ status: "error", reason: "store_unavailable" }, { status: 503 });
  }

  const deps: DispatchDeps = {
    async enqueue(job) {
      const run = await enqueueRun(admin, {
        workspaceId: job.workspaceId,
        ownerId: job.ownerId,
        projectId: null,
        agentId: null,
        agentKey: job.agentKey,
        target: "cloud",
        prompt: job.prompt,
        // Model choice stays at the Shipyard gateway: 'auto' lets the gateway own routing.
        model: job.model ?? LISTENER_RUN_MODEL,
        budgetCents: job.budgetCents,
        explore: job.explore ?? false,
      });
      return { id: run.id, payload: run.payload };
    },
    async patchRunPayload(runId, payload) {
      const { error } = await admin.from("task_runs").update({ payload }).eq("id", runId);
      if (error) throw new Error(`payload patch: ${error.message}`);
    },
    recordEvent: (runId, kind, data) => addEvent(admin, runId, kind, data),
    resolveExplore: (agentKey) => resolveAgentExplore(agentKey),
    now: () => new Date(),
    newCorrelationId: () => `corr_${randomUUID()}`,
  };

  const idempotencyKey = request.headers.get("idempotency-key");
  const plan = await receiveListenerEvent(deps, {
    repo: supabaseListenerRepo(admin),
    token,
    body,
    idempotencyKey,
  });

  if (plan.status === "error") {
    const unauthorized = plan.reason === "unknown_token";
    return NextResponse.json(
      { status: "error", reason: plan.reason },
      { status: unauthorized ? 401 : plan.reason === "store_unavailable" ? 503 : 500 },
    );
  }

  return NextResponse.json({
    status: plan.status,
    ...(plan.runId ? { runId: plan.runId } : {}),
    reason: plan.reason,
  });
}
