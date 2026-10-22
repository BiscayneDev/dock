// Live lease exclusivity against the Dock Supabase project (migration 0005). Skipped without env.
// Run: node --env-file-if-exists=.env.local --test test/task-queue.live.test.mjs
// Creates its own rows (payload.test = true) and deletes them afterwards.
import { test } from "node:test"
import assert from "node:assert/strict"
import { createClient } from "@supabase/supabase-js"

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
const live = Boolean(url && key)

test("lease exclusivity: two concurrent claims on one queued run, exactly one wins", { skip: !live && "no Supabase env" }, async () => {
  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data: ws, error: wsErr } = await admin.from("workspaces").select("id, owner_id").limit(1).single()
  assert.ifError(wsErr)
  const { data: run, error: insErr } = await admin
    .from("task_runs")
    .insert({ workspace_id: ws.id, owner_id: ws.owner_id, payload: { test: true, prompt: "lease test" }, budget_cents: 5 })
    .select("id")
    .single()
  assert.ifError(insErr)
  try {
    const claim = (w) => admin.rpc("claim_task_run", { p_worker: w, p_lease_seconds: 60 })
    const [a, b] = await Promise.all([claim("test-a"), claim("test-b")])
    assert.ifError(a.error)
    assert.ifError(b.error)
    const won = [a.data, b.data].filter((rows) => rows && rows.length === 1)
    assert.equal(won.length, 1, "exactly one claim must win the run")
    const winner = won[0][0]
    assert.equal(winner.id, run.id)
    assert.equal(winner.status, "leased")
    assert.equal(winner.attempts, 1)
    // The loser must not see the run again while the lease is live.
    const again = await claim("test-c")
    assert.equal((again.data ?? []).filter((r) => r.id === run.id).length, 0)
  } finally {
    await admin.from("task_run_events").delete().eq("run_id", run.id)
    await admin.from("task_runs").delete().eq("id", run.id)
  }
})

test("expired lease is recovered by the next claim, and the attempt cap fails the run", { skip: !live && "no Supabase env" }, async () => {
  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data: ws } = await admin.from("workspaces").select("id, owner_id").limit(1).single()
  const past = new Date(Date.now() - 60_000).toISOString()
  const { data: run } = await admin
    .from("task_runs")
    .insert({
      workspace_id: ws.id,
      owner_id: ws.owner_id,
      payload: { test: true, prompt: "expiry test" },
      budget_cents: 5,
      status: "leased",
      lease_owner: "dead-worker",
      lease_until: past,
      attempts: 3,
      max_attempts: 3,
    })
    .select("id")
    .single()
  try {
    const { data: rows, error } = await admin.rpc("claim_task_run", { p_worker: "test-d", p_lease_seconds: 60 })
    assert.ifError(error)
    assert.equal((rows ?? []).filter((r) => r.id === run.id).length, 0, "run at max attempts is not re-leased")
    const { data: row } = await admin.from("task_runs").select("status, error").eq("id", run.id).single()
    assert.equal(row.status, "failed")
    assert.equal(row.error, "lease expired")
    const { data: ev } = await admin.from("task_run_events").select("kind").eq("run_id", run.id)
    assert.ok(ev.some((e) => e.kind === "lease_expired"), "recovery is recorded as an event")
  } finally {
    await admin.from("task_run_events").delete().eq("run_id", run.id)
    await admin.from("task_runs").delete().eq("id", run.id)
  }
})
