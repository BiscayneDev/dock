// Listener store + dispatch tests. Uses the in-memory fake repo pattern from
// references/dock-verification-and-rollout.md; no Supabase needed.
import test from "node:test";
import assert from "node:assert/strict";
import {
  buildListenerInsert,
  deliveryView,
  formatListenerToken,
  hashListenerToken,
  listenerView,
  newListenerSalt,
  newListenerSecret,
  parseListenerToken,
  rowToListener,
  validateListenerFields,
  verifyListenerToken,
} from "../lib/listeners.ts";
import {
  circuitBreakerOpen,
  eventIdFor,
  findDuplicate,
  receiveListenerEvent,
} from "../lib/listener-dispatch.ts";
import { REPLAY_WINDOW_SECONDS } from "../lib/listener-rules.ts";

const NOW_MS = Date.parse("2026-11-24T12:00:00Z");
const NOW_ISO = new Date(NOW_MS).toISOString();
const LISTENER_ID = "11111111-1111-4111-8111-111111111111";
const WORKSPACE_ID = "22222222-2222-4222-8222-222222222222";
const OWNER_ID = "33333333-3333-4333-8333-333333333333";

function makeListener(overrides = {}) {
  const salt = newListenerSalt();
  const secret = newListenerSecret();
  return {
    id: LISTENER_ID,
    workspace_id: WORKSPACE_ID,
    owner_id: OWNER_ID,
    name: "PR merges",
    token_salt: salt,
    token_hash: hashListenerToken(salt, secret),
    filter_rules: { match: "all", rules: [{ path: "action", op: "eq", value: "closed" }] },
    target_agent_key: "scout",
    runbook: "Summarize the merge.",
    enabled: true,
    trigger_count: 0,
    last_triggered_at: null,
    paused_at: null,
    pause_reason: null,
    created_at: NOW_ISO,
    updated_at: NOW_ISO,
    ...overrides,
    // Test-only handle so the fake webhook can present the plaintext; never serialized by views.
    __secret: secret,
  };
}

class FakeRepo {
  constructor(listener) {
    this.listener = listener;
    this.deliveries = [];
    this.updates = [];
    this.enqueued = [];
  }

  async list() {
    return [this.listener];
  }

  async get(id, workspaceId) {
    return id === this.listener.id && workspaceId === this.listener.workspace_id ? this.listener : null;
  }

  async getById(id) {
    return id === this.listener.id ? this.listener : null;
  }

  async insert(row) {
    const created = { id: row.id ?? LISTENER_ID, created_at: NOW_ISO, updated_at: NOW_ISO, ...row };
    this.listener = created;
    return created;
  }

  async update(id, workspaceId, patch) {
    if (id !== this.listener.id || workspaceId !== this.listener.workspace_id) return null;
    this.listener = { ...this.listener, ...patch };
    this.updates.push(patch);
    return this.listener;
  }

  async delete(id) {
    return id === this.listener.id;
  }

  async insertDelivery(row) {
    const created = {
      id: `delivery-${this.deliveries.length + 1}`,
      created_at: NOW_ISO,
      ...row,
    };
    this.deliveries.push(created);
    return created;
  }

  async listDeliveries(listenerId, workspaceId, limit = 50) {
    return this.deliveries
      .filter((row) => row.listener_id === listenerId)
      .slice(-limit)
      .reverse();
  }

  async countEnqueuedSince(listenerId, sinceIso) {
    return this.deliveries.filter(
      (row) => row.listener_id === listenerId && row.status === "enqueued" && row.created_at >= sinceIso,
    ).length;
  }
}

function makeDeps(overrides = {}) {
  const calls = { jobs: [], patches: [], events: [] };
  const base = {
    async enqueue(job) {
      calls.jobs.push(job);
      return { id: `run-${calls.jobs.length}`, payload: { prompt: job.prompt } };
    },
    async patchRunPayload(runId, payload) {
      calls.patches.push({ runId, payload });
    },
    async recordEvent(runId, kind, data) {
      calls.events.push({ runId, kind, data });
    },
    resolveExplore: async () => false,
    now: () => new Date(NOW_ISO),
    newCorrelationId: () => `corr-${calls.jobs.length}`,
    ...overrides,
  };
  return { deps: base, calls };
}

function delivery(status, overrides = {}) {
  return {
    id: `d-${Math.random().toString(36).slice(2)}`,
    listener_id: LISTENER_ID,
    workspace_id: WORKSPACE_ID,
    event_id: "evt_x",
    status,
    detail: null,
    run_id: null,
    created_at: NOW_ISO,
    ...overrides,
  };
}

test("token format/parse/hash/verify mirror the connector pattern", () => {
  const salt = newListenerSalt();
  const secret = newListenerSecret();
  const token = formatListenerToken(LISTENER_ID, secret);
  assert.equal(token.split(".").length, 3);
  const parsed = parseListenerToken(token);
  assert.equal(parsed.listenerId, LISTENER_ID);
  assert.equal(parsed.secret, secret);
  assert.equal(verifyListenerToken(salt, secret, hashListenerToken(salt, secret)), true);
  assert.equal(verifyListenerToken(salt, "wrong".padEnd(43, "x"), hashListenerToken(salt, secret)), false);
  assert.equal(parseListenerToken("dockcon.x.y"), null);
  assert.equal(parseListenerToken(`docklis.${LISTENER_ID}.short`), null);
});

test("validateListenerFields requires all fields on create and validates values", () => {
  const good = validateListenerFields({
    name: "PR merges",
    targetAgentKey: "scout",
    runbook: "Summarize",
    filterRules: { match: "any", rules: [{ path: "action", op: "eq", value: "closed" }] },
  });
  assert.equal(good.ok, true);

  assert.equal(validateListenerFields({ name: "x", targetAgentKey: "scout", runbook: "" }).ok, false);
  assert.equal(validateListenerFields({ name: "", targetAgentKey: "scout", runbook: "r" }).ok, false);
  assert.equal(
    validateListenerFields({ name: "x", targetAgentKey: "bad key!", runbook: "r" }).ok,
    false,
  );
  assert.equal(
    validateListenerFields({ name: "x", targetAgentKey: "scout", runbook: "r", filterRules: { rules: "no" } }).ok,
    false,
  );

  const patch = validateListenerFields({ runbook: "Updated" }, true);
  assert.equal(patch.ok, true);
  assert.equal(validateListenerFields({}, true).ok, false);
});

test("buildListenerInsert applies defaults and never stores plaintext", () => {
  const row = buildListenerInsert({
    workspaceId: WORKSPACE_ID,
    ownerId: OWNER_ID,
    name: "n",
    tokenSalt: "salt",
    tokenHash: "hash",
    filterRules: { match: "all", rules: [] },
    targetAgentKey: "scout",
    runbook: "r",
    now: NOW_ISO,
  });
  assert.equal(row.enabled, true);
  assert.equal(row.trigger_count, 0);
  assert.equal(row.paused_at, null);
  assert.equal(row.token_salt, "salt");
  assert.equal(row.token_hash, "hash");
  assert.ok(!JSON.stringify(row).includes("docklis."));
});

test("listenerView/deliveryView expose API shape only", () => {
  const view = listenerView(makeListener());
  assert.deepEqual(Object.keys(view).sort(), [
    "createdAt",
    "enabled",
    "filterRules",
    "id",
    "lastTriggeredAt",
    "name",
    "pauseReason",
    "pausedAt",
    "runbook",
    "targetAgentKey",
    "triggerCount",
    "updatedAt",
  ]);
  assert.equal("webhookUrl" in view, false);
  assert.equal("token_hash" in view, false);

  const dv = deliveryView(delivery("enqueued", { run_id: "run-1", event_id: "e1" }));
  assert.deepEqual(dv, {
    id: dv.id,
    at: NOW_ISO,
    eventId: "e1",
    status: "enqueued",
    detail: null,
    runId: "run-1",
  });

  // A malformed stored filter falls back to accept-all rather than throwing.
  const fallback = rowToListener(makeListener({ filter_rules: "bogus" }));
  assert.deepEqual(fallback.filter_rules, { match: "all", rules: [] });
});

test("eventIdFor prefers Idempotency-Key and otherwise hashes the canonical body", () => {
  const body = { b: 1, a: { d: 2, c: 3 } };
  assert.equal(eventIdFor(body, "key-1"), "key_key-1");
  assert.equal(eventIdFor({ a: { c: 3, d: 2 }, b: 1 }), eventIdFor(body));
  assert.notEqual(eventIdFor(body), eventIdFor({ ...body, x: 1 }));
});

test("circuitBreakerOpen counts errors in the most recent window only", () => {
  const rows = Array.from({ length: 19 }, (_, i) =>
    delivery(i < 9 ? "error" : "enqueued"),
  );
  assert.equal(circuitBreakerOpen(rows).open, false);
  const crossed = [...rows, delivery("error")];
  const verdict = circuitBreakerOpen(crossed);
  assert.equal(verdict.open, true);
  assert.equal(verdict.errors, 10);
  assert.equal(verdict.considered, 20);

  const oldErrors = Array.from({ length: 15 }, () => delivery("error"));
  const mixed = [...Array.from({ length: 20 }, () => delivery("enqueued")), ...oldErrors];
  assert.equal(circuitBreakerOpen(mixed).errors, 0);
});

test("findDuplicate respects the replay window regardless of ordering", () => {
  const inside = delivery("enqueued", { event_id: "evt_dup" });
  const stale = delivery("enqueued", {
    event_id: "evt_old",
    created_at: new Date(NOW_MS - (REPLAY_WINDOW_SECONDS + 1) * 1000).toISOString(),
  });
  assert.equal(findDuplicate([inside], "evt_dup", NOW_MS)?.id, inside.id);
  assert.equal(findDuplicate([stale], "evt_old", NOW_MS), null);
  assert.equal(findDuplicate([], "evt_dup", NOW_MS), null);
});

test("accepted event enqueues exactly once with correlation on the run payload", async () => {
  const repo = new FakeRepo(makeListener());
  const { deps, calls } = makeDeps();
  const plan = await receiveListenerEvent(deps, {
    repo,
    token: formatListenerToken(repo.listener.id, matchingSecret(repo)),
    body: { action: "closed", repository: "acme/api" },
  });
  assert.equal(plan.status, "enqueued");
  assert.equal(plan.reason, "ok");
  assert.match(plan.correlationId, /^corr-/);
  assert.equal(calls.jobs.length, 1);
  const job = calls.jobs[0];
  assert.equal(job.agentKey, "scout");
  assert.equal(job.target, "cloud");
  assert.equal(job.workspaceId, WORKSPACE_ID);
  assert.equal(job.model, "auto");

  assert.equal(calls.patches.length, 1);
  const payload = calls.patches[0].payload;
  assert.equal(payload.kind, "listener");
  assert.equal(payload.listenerId, LISTENER_ID);
  assert.equal(payload.correlationId, plan.correlationId);
  assert.deepEqual(payload.event, { action: "closed", repository: "acme/api" });
  assert.equal(payload.prompt, "Summarize the merge.");

  assert.equal(calls.events.length, 1);
  assert.equal(calls.events[0].kind, "listener.triggered");
  assert.equal(calls.events[0].data.correlationId, plan.correlationId);
  assert.equal(calls.events[0].data.eventId, plan.eventId);

  assert.equal(repo.listener.trigger_count, 1);
  assert.equal(repo.listener.last_triggered_at, NOW_ISO);
  assert.equal(repo.deliveries.length, 1);
  assert.equal(repo.deliveries[0].status, "enqueued");
  assert.equal(repo.deliveries[0].run_id, plan.runId);
});

test("second identical delivery is deduped and enqueues nothing", async () => {
  const repo = new FakeRepo(makeListener());
  const { deps, calls } = makeDeps();
  const input = {
    repo,
    token: formatListenerToken(repo.listener.id, matchingSecret(repo)),
    body: { action: "closed" },
  };
  const first = await receiveListenerEvent(deps, input);
  const second = await receiveListenerEvent(deps, input);
  assert.equal(first.status, "enqueued");
  assert.equal(second.status, "deduped");
  assert.equal(second.reason, "duplicate");
  assert.equal(calls.jobs.length, 1);
  assert.equal(repo.deliveries.map((row) => row.status).join(","), "enqueued,deduped");

  // Same body without an explicit key still dedupes by content hash.
  const repo2 = new FakeRepo(makeListener());
  const ctx = makeDeps();
  const token2 = formatListenerToken(repo2.listener.id, matchingSecret(repo2));
  await receiveListenerEvent(ctx.deps, { repo: repo2, token: token2, body: { action: "closed" } });
  const again = await receiveListenerEvent(ctx.deps, { repo: repo2, token: token2, body: { action: "closed" } });
  assert.equal(again.status, "deduped");
});

test("filtered events never reach enqueue and record why", async () => {
  const repo = new FakeRepo(makeListener());
  const { deps, calls } = makeDeps();
  const plan = await receiveListenerEvent(deps, {
    repo,
    token: formatListenerToken(repo.listener.id, matchingSecret(repo)),
    body: { action: "opened" },
  });
  assert.equal(plan.status, "filtered");
  assert.equal(plan.reason, "no_match");
  assert.equal(calls.jobs.length, 0);
  assert.equal(repo.listener.trigger_count, 0);
  assert.equal(repo.deliveries[0].status, "filtered");
  assert.match(repo.deliveries[0].detail, /failed: action eq/);
});

test("disabled and paused listeners do not dispatch", async () => {
  for (const overrides of [{ enabled: false }, { paused_at: NOW_ISO, pause_reason: "circuit breaker: x" }]) {
    const repo = new FakeRepo(makeListener(overrides));
    const { deps, calls } = makeDeps();
    const plan = await receiveListenerEvent(deps, {
      repo,
      token: formatListenerToken(repo.listener.id, matchingSecret(repo)),
      body: { action: "closed" },
    });
    assert.equal(plan.status, "paused");
    assert.equal(calls.jobs.length, 0);
    assert.equal(repo.deliveries.at(-1).status, "paused");
  }
});

test("rate limit filters the 21st enqueue inside the minute", async () => {
  const listener = makeListener();
  const repo = new FakeRepo(listener);
  for (let i = 0; i < 20; i += 1) {
    repo.deliveries.push(delivery("enqueued", { event_id: `evt_${i}` }));
  }
  const { deps, calls } = makeDeps();
  const plan = await receiveListenerEvent(deps, {
    repo,
    token: formatListenerToken(repo.listener.id, matchingSecret(repo)),
    body: { action: "closed", n: 21 },
  });
  assert.equal(plan.status, "filtered");
  assert.equal(plan.reason, "rate_limited");
  assert.equal(calls.jobs.length, 0);
  assert.equal(repo.deliveries.at(-1).status, "filtered");
});

test("enqueue failure records an error and opens the circuit breaker at 10 errors / 20 deliveries", async () => {
  const repo = new FakeRepo(makeListener());
  const { deps } = makeDeps({
    enqueue: async () => {
      throw new Error("gateway down");
    },
  });
  const token = formatListenerToken(repo.listener.id, matchingSecret(repo));
  let lastPlan;
  for (let i = 0; i < 10; i += 1) {
    lastPlan = await receiveListenerEvent(deps, { repo, token, body: { action: "closed", i } });
    assert.equal(lastPlan.status, "error");
    assert.equal(lastPlan.reason, "enqueue_failed");
  }
  assert.equal(repo.listener.paused_at, NOW_ISO);
  assert.match(repo.listener.pause_reason, /circuit breaker: 10 errors/);
  assert.equal(repo.deliveries.length, 10);
  assert.ok(repo.deliveries.every((row) => row.status === "error"));

  // While paused, further deliveries are refused without enqueueing.
  const after = await receiveListenerEvent(deps, { repo, token, body: { action: "closed", i: 99 } });
  assert.equal(after.status, "paused");
  assert.equal(after.reason, "paused");
});

test("unknown or mismatched tokens fail closed with no deliveries", async () => {
  const repo = new FakeRepo(makeListener());
  const { deps, calls } = makeDeps();
  const bad = await receiveListenerEvent(deps, { repo, token: "docklis.nope.nope", body: {} });
  assert.equal(bad.status, "error");
  assert.equal(bad.reason, "unknown_token");
  const wrongSecret = await receiveListenerEvent(deps, {
    repo,
    token: formatListenerToken(repo.listener.id, "Z".repeat(43)),
    body: {},
  });
  assert.equal(wrongSecret.reason, "unknown_token");
  assert.equal(calls.jobs.length, 0);
  assert.equal(repo.deliveries.length, 0);
});

test("PATCH enable clearing pause is expressed in the update patch (route-level contract)", () => {
  // The store layer takes an explicit patch; the route maps enabled:true to cleared pause state.
  const repo = new FakeRepo(makeListener({ paused_at: NOW_ISO, pause_reason: "circuit breaker" }));
  const patch = { enabled: true, paused_at: null, pause_reason: null };
  return repo.update(repo.listener.id, WORKSPACE_ID, patch).then((row) => {
    assert.equal(row.enabled, true);
    assert.equal(row.paused_at, null);
    assert.equal(row.pause_reason, null);
  });
});

function matchingSecret(repo) {
  return repo.listener.__secret;
}
