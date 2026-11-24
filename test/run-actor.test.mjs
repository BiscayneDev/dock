// WS5 attribution persistence: enqueueRun must validate actorKind and write acting_as /
// actor_kind / actor_ref, with agent_token runs never carrying an invented owner.
//
// lib/queue.ts uses the "@/..." path alias (Next convention), so this test registers a
// resolve hook mapping "@/x" to "../x.ts" before dynamically importing it. No Supabase needed:
// a minimal in-memory fake records the inserted row and event.
import { test } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      let url = new URL("../" + specifier.slice(2), import.meta.url);
      if (!/\.[cm]?[jt]sx?$/.test(url.pathname)) url = new URL(url.href + ".ts");
      return nextResolve(url.href, context);
    }
    return nextResolve(specifier, context);
  },
});

const { enqueueRun, normalizeActorKind, normalizeActorRef } = await import("../lib/queue.ts");

function makeFake() {
  const runs = [];
  const events = [];
  let seq = 0;
  const resultFor = (data) => {
    const result = { data, error: null };
    return Object.assign(Promise.resolve(result), {
      select: () => ({ single: async () => result }),
    });
  };
  const client = {
    from(table) {
      if (table === "task_runs") {
        return {
          insert(values) {
            const row = {
              id: `run-${++seq}`,
              workspace_id: values.workspace_id,
              owner_id: values.owner_id,
              project_id: values.project_id ?? null,
              agent_id: values.agent_id ?? null,
              agent_key: values.agent_key,
              target: values.target,
              status: values.status ?? "queued",
              payload: values.payload ?? {},
              model: values.model ?? null,
              budget_cents: values.budget_cents ?? 0,
              spent_cents: 0,
              lease_owner: null,
              lease_until: null,
              attempts: 0,
              max_attempts: 3,
              error: null,
              output: null,
              created_at: "2026-11-24T12:00:00.000Z",
              updated_at: "2026-11-24T12:00:00.000Z",
              started_at: null,
              finished_at: null,
              acting_as: values.acting_as ?? null,
              actor_kind: values.actor_kind ?? null,
              actor_ref: values.actor_ref ?? null,
            };
            runs.push(row);
            return resultFor(row);
          },
        };
      }
      if (table === "task_run_events") {
        return {
          insert(values) {
            events.push({ id: `ev-${events.length + 1}`, ...values });
            return resultFor(null);
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
  return { client, runs, events };
}

const BASE = {
  workspaceId: "ws-1",
  ownerId: "user-1",
  projectId: null,
  agentId: null,
  agentKey: "vic",
  target: "cloud",
  prompt: "do the thing",
  model: "model-x",
  budgetCents: 100,
};

test("enqueue defaults to owner attribution bound to ownerId", async () => {
  const fake = makeFake();
  const run = await enqueueRun(fake.client, { ...BASE });
  assert.equal(run.actorKind, "owner");
  assert.equal(run.actingAs, "user-1");
  assert.equal(run.actorRef, null);
  assert.equal(fake.runs[0].actor_kind, "owner");
  assert.equal(fake.runs[0].acting_as, "user-1");
  assert.equal(fake.runs[0].actor_ref, null);
  assert.equal(fake.events.length, 1);
  assert.equal(fake.events[0].kind, "queued");
});

test("explicit actingAs is honored for owner runs", async () => {
  const fake = makeFake();
  const run = await enqueueRun(fake.client, { ...BASE, actingAs: "user-2" });
  assert.equal(run.actingAs, "user-2");
  assert.equal(fake.runs[0].acting_as, "user-2");
});

test("agent_token runs never carry an owner, even if one is supplied", async () => {
  const fake = makeFake();
  const run = await enqueueRun(fake.client, {
    ...BASE,
    actorKind: "agent_token",
    actingAs: "user-1",
    actorRef: "tok-abc",
  });
  assert.equal(run.actorKind, "agent_token");
  assert.equal(run.actingAs, null);
  assert.equal(run.actorRef, "tok-abc");
  assert.equal(fake.runs[0].acting_as, null);
  assert.equal(fake.runs[0].actor_kind, "agent_token");
});

test("connector metadata attributes the connection's owner without editing the caller", async () => {
  const fake = makeFake();
  const run = await enqueueRun(fake.client, {
    ...BASE,
    connector: { connectionId: "conn-9", clientMessageId: "msg-1" },
    actorRef: "conn-9",
  });
  assert.equal(run.actorKind, "connector");
  assert.equal(run.actingAs, "user-1");
  assert.equal(fake.runs[0].actor_kind, "connector");
  assert.equal(fake.runs[0].acting_as, "user-1");
});

test("explicit connector kind and actingAs are written through", async () => {
  const fake = makeFake();
  const run = await enqueueRun(fake.client, { ...BASE, actorKind: "connector", actingAs: "user-7" });
  assert.equal(run.actorKind, "connector");
  assert.equal(run.actingAs, "user-7");
});

test("unknown actorKind throws before any database write", async () => {
  const fake = makeFake();
  await assert.rejects(() => enqueueRun(fake.client, { ...BASE, actorKind: "admin" }), /invalid actor kind/);
  assert.equal(fake.runs.length, 0);
  assert.equal(fake.events.length, 0);
});

test("actor_ref is trimmed, clipped, and empty becomes null", async () => {
  const fake = makeFake();
  const run = await enqueueRun(fake.client, { ...BASE, actorRef: "  conn-9  " });
  assert.equal(run.actorRef, "conn-9");
  const long = await enqueueRun(fake.client, { ...BASE, actorRef: "x".repeat(500) });
  assert.equal(long.actorRef.length, 200);
  const empty = await enqueueRun(fake.client, { ...BASE, actorRef: "   " });
  assert.equal(empty.actorRef, null);
});

test("normalizeActorKind fails closed: only the three kinds, everything else unknown", () => {
  assert.equal(normalizeActorKind("owner"), "owner");
  assert.equal(normalizeActorKind("agent_token"), "agent_token");
  assert.equal(normalizeActorKind("connector"), "connector");
  assert.equal(normalizeActorKind(undefined), "unknown");
  assert.equal(normalizeActorKind(null), "unknown");
  assert.equal(normalizeActorKind("Owner"), "unknown");
  assert.equal(normalizeActorKind(""), "unknown");
});

test("normalizeActorRef clips to the migration limit and drops blanks", () => {
  assert.equal(normalizeActorRef("  abc "), "abc");
  assert.equal(normalizeActorRef("y".repeat(250)).length, 200);
  assert.equal(normalizeActorRef(""), null);
  assert.equal(normalizeActorRef(undefined), null);
  assert.equal(normalizeActorRef(null), null);
});
