// Inbox aggregation: group mapping for every source, tab filters, sorting and search.
// Run: node --test test/inbox-query.test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import {
  filterInbox,
  inboxCounts,
  queryInbox,
  searchInbox,
  sortInbox,
  toInboxItems,
} from "../lib/inbox-query.ts"

const T0 = "2026-11-24T10:00:00.000Z"
const T1 = "2026-11-24T11:00:00.000Z"
const T2 = "2026-11-24T12:00:00.000Z"

function decision(overrides = {}) {
  return {
    id: "d1",
    kind: "approval",
    status: "pending",
    title: "Approve spend",
    summary: "Dataset purchase",
    artifact_ref: "run:r1:act-1",
    artifact_hash: "a".repeat(64),
    requested_by_run: "r1",
    created_at: T0,
    updated_at: T0,
    ...overrides,
  }
}

function alert(overrides = {}) {
  return {
    id: "a1",
    type: "run.failed",
    severity: "critical",
    status: "open",
    title: "Run failed",
    summary: "boom",
    runId: "r2",
    createdAt: T0,
    updatedAt: T0,
    ...overrides,
  }
}

function run(overrides = {}) {
  return {
    id: "r1",
    status: "awaiting_approval",
    agent_key: "vic",
    budgetCents: 1000,
    created_at: T0,
    updated_at: T0,
    ...overrides,
  }
}

function brief(overrides = {}) {
  return {
    id: "b1",
    state: "proposed",
    goal: "Ship the report",
    context: "Context",
    budgetCents: 250,
    created_at: T0,
    updated_at: T0,
    ...overrides,
  }
}

function message(overrides = {}) {
  return {
    id: "m1",
    role: "assistant",
    content: "Draft ready",
    agent: "vic",
    createdAt: T0,
    updatedAt: T0,
    ...overrides,
  }
}

test("decisions, alerts, runs, briefs and messages flatten into one queue", () => {
  const items = toInboxItems({
    decisions: [decision()],
    alerts: [alert()],
    runs: [run()],
    briefs: [brief()],
    messages: [message()],
  })
  assert.equal(items.length, 5)
  assert.deepEqual(
    items.map((i) => i.type).sort(),
    ["alert", "brief", "decision", "message", "run"],
  )
})

test("each source maps to the expected tab", () => {
  const item = (input) => toInboxItems(input)[0]
  assert.equal(item({ decisions: [decision({ status: "pending" })] }).group, "needs-you")
  assert.equal(item({ decisions: [decision({ status: "changes_requested" })] }).group, "running")
  assert.equal(item({ decisions: [decision({ status: "reassigned" })] }).group, "running")
  assert.equal(item({ decisions: [decision({ status: "escalated" })] }).group, "running")
  assert.equal(item({ decisions: [decision({ status: "approved" })] }).group, "done")
  assert.equal(item({ decisions: [decision({ status: "snoozed" })] }).group, "done")
  assert.equal(item({ alerts: [alert({ status: "open" })] }).group, "needs-you")
  assert.equal(item({ alerts: [alert({ status: "acknowledged" })] }).group, "done")
  assert.equal(item({ runs: [run({ status: "queued" })] }).group, "running")
  assert.equal(item({ runs: [run({ status: "awaiting_approval" })] }).group, "needs-you")
  assert.equal(item({ runs: [run({ status: "failed" })] }).group, "done")
  assert.equal(item({ briefs: [brief({ state: "proposed" })] }).group, "needs-you")
  assert.equal(item({ briefs: [brief({ state: "running" })] }).group, "running")
  assert.equal(item({ briefs: [brief({ state: "succeeded" })] }).group, "done")
})

test("filterInbox and inboxCounts", () => {
  const input = {
    decisions: [decision({ id: "p", status: "pending" }), decision({ id: "a", status: "approved", updated_at: T1 })],
    alerts: [alert({ id: "ao", status: "open" })],
    runs: [run({ id: "rr", status: "running" })],
  }
  const all = toInboxItems(input)
  assert.equal(all.length, 4)
  assert.deepEqual(
    filterInbox(all, "needs-you").map((i) => i.key).sort(),
    ["alert:ao", "decision:p"].sort(),
  )
  assert.equal(filterInbox(all, "running").length, 1)
  assert.equal(filterInbox(all, "done").length, 1)
  assert.deepEqual(inboxCounts(all), { all: 4, "needs-you": 2, running: 1, done: 1 })
})

test("sortInbox is newest activity first with pending work winning ties", () => {
  const items = toInboxItems({
    decisions: [
      decision({ id: "old-pending", status: "pending", updated_at: T0, created_at: T0 }),
      decision({ id: "new-done", status: "approved", updated_at: T2, created_at: T2 }),
      decision({ id: "mid-pending", status: "pending", updated_at: T1, created_at: T1 }),
    ],
  })
  assert.deepEqual(items.map((i) => i.key), ["decision:new-done", "decision:mid-pending", "decision:old-pending"])

  const tied = sortInbox([
    { ...toInboxItems({ decisions: [decision({ id: "x", status: "approved", updated_at: T0 })] })[0], updatedAt: T1 },
    { ...toInboxItems({ decisions: [decision({ id: "y", status: "pending", updated_at: T1 })] })[0], updatedAt: T1 },
  ])
  assert.equal(tied[0].key, "decision:y")
})

test("searchInbox matches title, summary, artifact ref, goal and message content", () => {
  const items = toInboxItems({
    decisions: [decision({ title: "Approve spend", artifact_ref: "run:r1:act-1" })],
    briefs: [brief({ goal: "Ship the report" })],
    messages: [message({ content: "Quarterly draft" })],
  })
  assert.equal(searchInbox(items, "spend").length, 1)
  assert.equal(searchInbox(items, "ACT-1").length, 1)
  assert.equal(searchInbox(items, "report").length, 1)
  assert.equal(searchInbox(items, "draft").length, 1)
  assert.equal(searchInbox(items, "   ").length, 3)
})

test("queryInbox applies filter + search, falls back on an unknown filter, and limits", () => {
  const input = {
    decisions: [
      decision({ id: "p", status: "pending", title: "Approve dataset" }),
      decision({ id: "a", status: "approved", title: "Approve invoice", updated_at: T1 }),
    ],
    runs: [run({ id: "rr", status: "running", updated_at: T1 })],
  }
  const q = queryInbox(input, { filter: "needs-you", search: "dataset" })
  assert.deepEqual(q.items.map((i) => i.key), ["decision:p"])
  assert.equal(q.counts.all, 3)
  assert.equal(queryInbox(input, { filter: "nope" }).filter, "all")
  const limited = queryInbox(input, { limit: 1 })
  assert.equal(limited.items.length, 1)
})
