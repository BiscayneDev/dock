// Pure-logic tests for lib/schedules.ts (node --test, mirrors watermarks.test.mjs style).
import test from "node:test"
import assert from "node:assert/strict"

const { isDue, dueSchedules, scheduleFeedId } = await import("../lib/schedules.ts")

function schedule(overrides = {}) {
  return {
    id: "s1",
    name: "Test",
    agent: "scout",
    prompt: "hello",
    frequency: "hourly",
    hour: 9,
    timezone: "UTC",
    enabled: true,
    lastRunAt: null,
    nextRunAt: null,
    lastStatus: null,
    lastError: null,
    createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  }
}

test("isDue: disabled schedules never due", () => {
  assert.equal(isDue(schedule({ enabled: false }), new Date("2026-06-01T00:00:00Z")), false)
})

test("isDue: no nextRunAt means due", () => {
  assert.equal(isDue(schedule({ nextRunAt: null }), new Date("2026-06-01T00:00:00Z")), true)
})

test("isDue: respects nextRunAt boundary", () => {
  const s = schedule({ nextRunAt: "2026-06-01T12:00:00Z" })
  assert.equal(isDue(s, new Date("2026-06-01T11:59:59Z")), false)
  assert.equal(isDue(s, new Date("2026-06-01T12:00:00Z")), true)
})

test("dueSchedules: filters to due schedules only, preserves order", () => {
  const past = schedule({ id: "past", nextRunAt: "2026-06-01T00:00:00Z" })
  const future = schedule({ id: "future", nextRunAt: "2999-01-01T00:00:00Z" })
  const disabled = schedule({ id: "disabled", enabled: false })
  const out = dueSchedules(new Date("2026-06-02T00:00:00Z"), [future, disabled, past])
  assert.deepEqual(out.map((s) => s.id), ["past"])
})

test("scheduleFeedId convention", () => {
  assert.equal(scheduleFeedId("abc"), "schedule:abc")
})
