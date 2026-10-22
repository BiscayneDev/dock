// Pure helpers for the headless runs CLI (`dock runs list` / `dock run` / `dock runs watch`).
// No network. Run: node --test test/runs-cli.test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import {
  formatRunRow,
  isTerminalStatus,
  newEventLines,
  parseRunArgs,
  runOutcome,
} from "../bin/runs-cli.mjs"

test("isTerminalStatus accepts terminal statuses only", () => {
  for (const s of ["succeeded", "failed", "cancelled", "rejected"]) assert.equal(isTerminalStatus(s), true)
  for (const s of ["queued", "leased", "running", "awaiting_approval", "", undefined, null]) {
    assert.equal(isTerminalStatus(s), false)
  }
})

test("parseRunArgs extracts flags and positionals", () => {
  const { flags, positional } = parseRunArgs(["--agent", "chief", "--prompt", "do the thing", "--budget", "250"])
  assert.deepEqual(flags, { agent: "chief", prompt: "do the thing", budget: "250" })
  assert.deepEqual(positional, [])

  const watch = parseRunArgs(["abc-123"])
  assert.deepEqual(watch.positional, ["abc-123"])
  assert.deepEqual(watch.flags, {})

  // A value-taking flag with no value is a usage error, not a silent undefined.
  assert.throws(() => parseRunArgs(["--agent"]), /--agent requires a value/)

  // Unknown --flags (not value-taking) still fall through without crashing.
  const odd = parseRunArgs(["--yolo"])
  assert.deepEqual(odd.flags, {})
  assert.deepEqual(odd.positional, [])
})

test("formatRunRow aligns columns", () => {
  const row = formatRunRow({ id: "12345678-aaaa-bbbb", agentKey: "chief", status: "queued", createdAt: "2026-10-22T12:00:00.000Z" })
  assert.match(row, /^ {2}12345678 /)
  assert.match(row, /chief\s+queued\s+2026-10-22 12:00:00$/)
})

test("newEventLines only returns events after the seen cursor", () => {
  const events = [
    { kind: "queued", createdAt: "2026-10-22T10:00:00.000Z", data: { target: "cloud" } },
    { kind: "started", createdAt: "2026-10-22T10:00:05.000Z", data: {} },
    { kind: "output", createdAt: "2026-10-22T10:00:09.000Z", data: { note: "hi" } },
  ]
  const first = newEventLines(events, 0)
  assert.equal(first.length, 3)
  assert.match(first[0], /queued \{"target":"cloud"\}/)
  const rest = newEventLines(events, 2)
  assert.equal(rest.length, 1)
  assert.match(rest[0], /output \{"note":"hi"\}/)
})

test("runOutcome surfaces output, then error, then bare status", () => {
  assert.match(runOutcome({ id: "r1", status: "succeeded", output: "all done" }), /all done/)
  assert.match(runOutcome({ id: "r1", status: "failed", error: "boom" }), /Error: boom/)
  assert.equal(runOutcome({ id: "r1", status: "queued" }), "  Run r1 queued")
})
